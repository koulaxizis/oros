// Pure logic of Pet World (petworld/petworld.js): the "petworld"
// slice merge, the per-device ledger, the pet binding, a fresh start,
// the "petgarden" slice (beds, growth, watering, harvests) and the
// "petnest" slice (walks, loot, nest stages, decorations), the
// "petgames" slice (game records) and the "petprogress" slice (care
// days, the accessory worn) with the derived XP, level and achievements.
// Run: node --test tests/
//
// The app is a browser IIFE with no exports, so the pure functions
// are cut out of the source by name and evaluated on their own (same
// loader as tests/games.test.js). A renamed function fails loudly.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function load(file, names, preludes, ret) {
  const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const parts = preludes.map(([from, to]) => {
    const i = src.indexOf(from), j = src.indexOf(to, i);
    if (i < 0 || j < 0) throw new Error("missing block " + from);
    return src.slice(i, j);
  });
  names.forEach((name) => {
    const i = src.indexOf("  function " + name + "(");
    if (i < 0) throw new Error("missing function " + name);
    parts.push(src.slice(i, src.indexOf("\n  }\n", i) + 4));
  });
  return new Function(parts.join("\n") + "\nreturn {" + ret + "};")();
}

// cmpStr's cut also takes isCount, isTs and normPet, the functions after it.
const PW = load("petworld/petworld.js",
  ["cmpStr", "normRow", "joinRows", "mergeWorld", "defaultData",
   "worldHasContent", "ledger", "freshStart", "bindPet",
   "normTot", "normPlot", "joinPlot", "mergeGarden", "defaultGarden", "yieldOf", "growthSpan",
   "readyAt", "plotState", "withPlot", "plantSeed", "waterPlot", "harvestPlot", "digUp",
   "freshGarden", "stock", "gardenHasContent", "clamp",
   "normWalks", "normNestRow", "joinNestRow", "mergeNest", "defaultNest", "lootOf", "walkList",
   "activeWalk", "lastWalk", "withNestRow", "foldWalks", "startWalk", "nestNet", "nestStage",
   "buildable", "buildNest", "freshNest", "nestHasContent", "mulberry",
   "normGameRow", "joinGameRows", "mergeGames", "defaultGames", "recordGame", "gameStats",
   "freshGames", "gamesHasContent",
   "normWear", "mergeProgress", "defaultProgress", "addCareDays", "setWear", "freshProgress",
   "progressHasContent", "longestStreak", "progressStats", "achievementsDone", "xpOf", "levelXP",
   "levelOf", "bedCount", "acornsFor"],
  [["  var DATA_VER", "  var WAKE_AT"], ["  var HOUR", "  function normTot("], ["  var MIN = ", "  function normWalks("],
   ["  var GAMES = ", "  function normGameRow("], ["  var DAY = ", "  function normWear("]],
  "mergeWorld, defaultData, worldHasContent, ledger, freshStart, bindPet, mergeGarden, " +
  "defaultGarden, plotState, plantSeed, waterPlot, harvestPlot, digUp, freshGarden, stock, " +
  "gardenHasContent, CROPS, START_PACK, HOUR, mergeNest, defaultNest, lootOf, activeWalk, lastWalk, " +
  "foldWalks, startWalk, nestStage, buildNest, freshNest, nestHasContent, MIN, NEST, DECOR, " +
  "mergeGames, defaultGames, recordGame, gameStats, freshGames, gamesHasContent, " +
  "mergeProgress, defaultProgress, addCareDays, setWear, freshProgress, progressHasContent, longestStreak, " +
  "progressStats, achievementsDone, xpOf, levelXP, levelOf, bedCount, acornsFor, yieldOf, DAY, ACCESSORIES, ACHIEVEMENTS");

const J = JSON.stringify;
const rnd = (n) => Math.floor(Math.random() * n);
const ITEMS = ["acorn", "twig", "seed_carrot", "leaf", "Bad!", "x".repeat(30)];

function randomWorld() {
  const rows = {};
  for (let i = 0; i < rnd(4); i++) {
    const c = {};
    ITEMS.forEach((k) => { if (rnd(2)) c[k] = rnd(8) ? [rnd(6), rnd(4)] : [-1, 2]; });
    rows["d" + rnd(4)] = { b: rnd(3) * 100, c };
  }
  const pet = rnd(3) ? { id: "p" + rnd(3), ts: rnd(4) * 10 } : null;
  return { ver: 1, br: rnd(3) ? 0 : rnd(3) * 100, pet, rows };
}

test("petworld: merge is a join (symmetric, associative, idempotent) and pure", () => {
  const M = PW.mergeWorld;
  for (let i = 0; i < 20000; i++) {
    const a = randomWorld(), b = randomWorld(), c = randomWorld(), sa = J(a), sb = J(b);
    const ab = M(a, b);
    assert.equal(J(ab), J(M(b, a)));
    assert.equal(J(M(ab, ab)), J(ab));
    assert.equal(J(M(ab, null)), J(ab));                       // canonical form is a fixed point
    assert.equal(J(M(M(a, b), c)), J(M(a, M(b, c))));
    assert.equal(J(a), sa);
    assert.equal(J(b), sb);
  }
});

test("petworld: rows keep the newer epoch, equal epochs take the max per counter", () => {
  const M = PW.mergeWorld;
  const x = { rows: { d1: { b: 5, c: { acorn: [4, 1], twig: [2, 0] } } } };
  const y = { rows: { d1: { b: 5, c: { acorn: [3, 2], leaf: [1, 0] } } } };
  assert.equal(J(M(x, y).rows.d1.c), J({ acorn: [4, 2], leaf: [1, 0], twig: [2, 0] }));
  const z = { rows: { d1: { b: 9, c: { leaf: [7, 0] } } } };
  assert.equal(J(M(x, z).rows.d1), J({ b: 9, c: { leaf: [7, 0] } }));
  // bad cells and ids drop; well-formed unknown items survive
  const bad = { rows: { d1: { b: 1, c: { acorn: [-1, 0], "Bad!": [1, 0], future_item: [2, 1], twig: [1.5, 0] } }, "no way": { b: 1, c: {} } } };
  assert.equal(J(M(bad, null).rows), J({ d1: { b: 1, c: { future_item: [2, 1] } } }));
  assert.equal(J(M("junk", 42)), J(PW.defaultData()));
});

test("petworld: balances add across devices, a fresh start drops older rows everywhere", () => {
  let d = PW.defaultData();
  d = PW.ledger(d, "dA", "acorn", 5, 0);
  d = PW.ledger(d, "dA", "acorn", 0, 2);
  const other = PW.ledger(PW.defaultData(), "dB", "acorn", 4, 1);
  let m = PW.mergeWorld(d, other);
  const G0 = PW.defaultGarden();
  assert.equal(PW.stock(m, G0, "acorn"), 5 + 6);                 // + the start purse (phase 5)
  assert.equal(PW.stock(m, G0, "twig"), 0);
  assert.ok(PW.worldHasContent(m));
  assert.ok(!PW.worldHasContent(PW.defaultData()));

  // Fresh start on device A: B's old row disappears when they meet.
  const fresh = PW.freshStart(m, "pNew", 1000);
  assert.equal(fresh.br, 1000);
  assert.equal(J(fresh.pet), J({ id: "pNew", ts: 1000 }));
  m = PW.mergeWorld(fresh, other);
  assert.equal(J(m.rows), "{}");
  assert.ok(!PW.worldHasContent(m));
  // A later move on B starts a row at the new epoch and survives.
  const later = PW.ledger(m, "dB", "twig", 1, 0);
  assert.equal(later.rows.dB.b, 1000);
  assert.equal(PW.stock(PW.mergeWorld(later, fresh), G0, "twig"), 1);
});

test("petworld: the pet binding follows the newest choice", () => {
  let d = PW.bindPet(PW.defaultData(), "p1", 50);
  assert.equal(J(d.pet), J({ id: "p1", ts: 50 }));
  const keep = PW.bindPet(d, "p2", 40);                    // clock behind: still newer than the old binding
  assert.equal(keep.pet.id, "p2");
  assert.ok(keep.pet.ts > 50);
  assert.equal(PW.mergeWorld(d, keep).pet.id, "p2");
  assert.equal(PW.mergeWorld({ pet: { id: "a", ts: 5 } }, { pet: { id: "b", ts: 5 } }).pet.id, "b");
  assert.equal(PW.mergeWorld({ pet: { id: "<x>", ts: 5 } }, null).pet, null);
});

function randomGarden() {
  const plots = {};
  for (let i = 0; i < rnd(4); i++) {
    const tot = {};
    ["carrot", "seed_carrot", "apple", "Bad!"].forEach((k) => { if (rnd(2)) tot[k] = rnd(5); });
    plots[String(rnd(4))] = { s: ["", "carrot", "apple", "future_plant"][rnd(4)], t: rnd(4) * 10,
                              n: rnd(3), wn: rnd(4) - 1, tot };
  }
  if (!rnd(6)) plots["x"] = { s: "carrot", t: 5, n: 0, wn: -1, tot: {} };
  return { ver: 1, br: rnd(3) ? 0 : rnd(3) * 10, plots };
}

test("petgarden: merge is a join and pure", () => {
  const M = PW.mergeGarden;
  for (let i = 0; i < 20000; i++) {
    const a = randomGarden(), b = randomGarden(), c = randomGarden(), sa = J(a);
    const ab = M(a, b);
    assert.equal(J(ab), J(M(b, a)));
    assert.equal(J(M(ab, ab)), J(ab));
    assert.equal(J(M(ab, null)), J(ab));
    assert.equal(J(M(M(a, b), c)), J(M(a, M(b, c))));
    assert.equal(J(a), sa);
    Object.keys(ab.plots).forEach((id) => assert.ok(ab.plots[id].t >= ab.br));
  }
});

test("petgarden: a carrot grows in 4 h, 3 h when watered, and yields once", () => {
  const H = PW.HOUR, t0 = 1000000;
  let g = PW.plantSeed(PW.defaultGarden(), "0", "carrot", t0);
  assert.equal(PW.plotState(g.plots["0"], t0).state, "growing");
  assert.equal(PW.plotState(g.plots["0"], t0 + 4 * H - 1).state, "growing");
  assert.equal(PW.plotState(g.plots["0"], t0 + 4 * H).state, "ready");
  assert.equal(PW.plantSeed(g, "0", "apple", t0 + 1), g);              // the bed is taken
  const w = PW.waterPlot(g, "0", t0 + H);
  assert.equal(PW.plotState(w.plots["0"], t0 + 3 * H).state, "ready");
  assert.equal(PW.waterPlot(w, "0", t0 + 2 * H), w);                   // once per growth
  assert.equal(PW.harvestPlot(w, "0", t0 + 2 * H).g, w);               // not ripe yet

  // Two devices pick the same carrot offline: one harvest after the merge.
  const A = PW.harvestPlot(w, "0", t0 + 3 * H), B = PW.harvestPlot(w, "0", t0 + 5 * H);
  assert.equal(J(A.got), J(B.got));
  const got = A.got.carrot;
  assert.ok(got >= 2 && got <= 3);
  const m = PW.mergeGarden(A.g, B.g);
  assert.equal(PW.stock(PW.defaultData(), m, "carrot"), got);
  assert.equal(PW.stock(PW.defaultData(), m, "seed_carrot"), PW.START_PACK.seed_carrot + A.got.seed_carrot);
  assert.equal(PW.plotState(m.plots["0"], t0 + 6 * H).state, "empty");  // an annual is done

  // Replanting keeps the harvest total; digging up keeps it too.
  let r = PW.plantSeed(m, "0", "strawberry", t0 + 6 * H);
  assert.equal(r.plots["0"].tot.carrot, got);
  r = PW.digUp(r, "0", t0 + 7 * H);
  assert.equal(r.plots["0"].s, "");
  assert.equal(PW.stock(PW.defaultData(), r, "carrot"), got);
});

test("petgarden: an apple tree fruits again every 24 h", () => {
  const H = PW.HOUR, t0 = 0;
  let g = PW.plantSeed(PW.defaultGarden(), "1", "apple", t0);
  assert.equal(PW.plotState(g.plots["1"], 72 * H - 1).state, "growing");
  let h = PW.harvestPlot(g, "1", 80 * H);
  assert.ok(h.got.apple >= 3);
  const st = PW.plotState(h.g.plots["1"], 80 * H);
  assert.equal(st.state, "growing");
  assert.ok(st.adult);
  assert.equal(PW.plotState(h.g.plots["1"], 96 * H).state, "ready");     // 72 + 24
  const h2 = PW.harvestPlot(h.g, "1", 96 * H);
  assert.equal(PW.stock(PW.defaultData(), h2.g, "apple"), h.got.apple + h2.got.apple);
});

test("petgarden: a fresh start empties the beds on every device", () => {
  const t0 = 5000;
  const g = PW.plantSeed(PW.defaultGarden(), "2", "mushroom", t0);
  assert.ok(PW.gardenHasContent(g));
  assert.ok(!PW.gardenHasContent(PW.defaultGarden()));
  const fresh = PW.freshGarden(g, t0 + 10);
  assert.equal(J(fresh.plots), "{}");
  assert.equal(J(PW.mergeGarden(g, fresh).plots), "{}");
  // A planting after the fresh start survives.
  const later = PW.plantSeed(fresh, "2", "carrot", t0 + 20);
  assert.equal(PW.mergeGarden(later, g).plots["2"].s, "carrot");
  // The start pack is there before anything happens.
  assert.equal(PW.stock(PW.defaultData(), PW.defaultGarden(), "seed_strawberry"), PW.START_PACK.seed_strawberry);
});

function randomNest() {
  const built = {};
  ["n1", "n2", "n3", "path", "Bad!"].forEach((k) => { if (rnd(2)) built[k] = rnd(4) * 10; });
  const rows = {};
  for (let i = 0; i < rnd(4); i++) {
    const w = {};
    for (let j = 0; j < rnd(3); j++) w[String(rnd(5) * 1000)] = [15, 30, 60, 0, 2000][rnd(5)];
    const sum = {};
    ["twig", "leaf", "Bad!"].forEach((k) => { if (rnd(2)) sum[k] = rnd(5); });
    rows["d" + rnd(3)] = { b: rnd(3) * 10, v: rnd(3), w, sum };
  }
  if (!rnd(8)) rows["no way"] = { b: 0, v: 0, w: {}, sum: {} };
  return { ver: 1, br: rnd(3) ? 0 : rnd(3) * 10, built, rows };
}

test("petnest: merge is a join and pure", () => {
  const M = PW.mergeNest;
  for (let i = 0; i < 20000; i++) {
    const a = randomNest(), b = randomNest(), c = randomNest(), sa = J(a);
    const ab = M(a, b);
    assert.equal(J(ab), J(M(b, a)));
    assert.equal(J(M(ab, ab)), J(ab));
    assert.equal(J(M(ab, null)), J(ab));
    assert.equal(J(M(M(a, b), c)), J(M(a, M(b, c))));
    assert.equal(J(a), sa);
    Object.keys(ab.built).forEach((k) => assert.ok(ab.built[k] >= ab.br));
    Object.keys(ab.rows).forEach((d) => assert.ok(ab.rows[d].b >= ab.br));
  }
});

test("petnest: a walk takes its real time, one at a time, and every device sees the same loot", () => {
  const t0 = 1700000000000, MIN = PW.MIN, D = PW.defaultData(), G = PW.defaultGarden();
  let n = PW.startWalk(PW.defaultNest(), "dA", 30, t0);
  assert.equal(PW.activeWalk(n, t0 + 29 * MIN).s, t0);
  assert.equal(PW.activeWalk(n, t0 + 30 * MIN), null);
  assert.equal(PW.startWalk(n, "dB", 15, t0 + 10 * MIN), n);              // already out
  assert.equal(PW.startWalk(n, "dA", 20, t0 + 40 * MIN), n);              // not a walk length
  assert.equal(PW.stock(D, G, "twig", n, t0 + 29 * MIN), 0);             // nothing until home
  const got = PW.lootOf("dA", t0, 30);
  const mats = ["twig", "leaf", "moss", "pebble"].reduce((s, k) => s + (got[k] || 0), 0);
  assert.ok(mats >= 4 && mats <= 5);
  assert.equal(PW.stock(D, G, "twig", n, t0 + 30 * MIN), got.twig || 0);
  // another device, after sync, counts the very same finds
  const other = PW.mergeNest(PW.defaultNest(), n);
  assert.equal(PW.stock(D, G, "leaf", other, t0 + 31 * MIN), got.leaf || 0);

  // A second walk folds the first into the row's sum: same totals.
  const t1 = t0 + 60 * MIN;
  const n2 = PW.startWalk(n, "dA", 60, t1);
  assert.equal(Object.keys(n2.rows.dA.w).length, 1);
  assert.ok(n2.rows.dA.v > n.rows.dA.v);
  ["twig", "leaf", "moss", "pebble"].forEach((k) =>
    assert.equal(PW.stock(D, G, k, n2, t1), PW.stock(D, G, k, n, t1)));
  // the stale copy (before the fold) loses to the folded row: no double count
  const m = PW.mergeNest(n, n2);
  assert.equal(J(m), J(n2));
  const all = PW.lootOf("dA", t1, 60);
  ["twig", "leaf"].forEach((k) =>
    assert.equal(PW.stock(D, G, k, m, t1 + 60 * MIN), (got[k] || 0) + (all[k] || 0)));
  assert.equal(PW.lastWalk(m).s, t1);
  // a newest walk is never folded, even when it is over
  assert.equal(PW.foldWalks(m, "dA", t1 + 999 * MIN), m);
});

test("petnest: walk lengths give their loot", () => {
  const sumMats = (g) => ["twig", "leaf", "moss", "pebble"].reduce((s, k) => s + (g[k] || 0), 0);
  let seeds60 = 0, finds60 = 0;
  for (let i = 0; i < 400; i++) {
    const a = PW.lootOf("dX", 1000 + i, 15), b = PW.lootOf("dX", 1000 + i, 60);
    assert.ok(sumMats(a) >= 2 && sumMats(a) <= 3);
    assert.equal(Object.keys(a).filter((k) => k.indexOf("seed_") === 0).length, 0);
    assert.ok(sumMats(b) >= 8 && sumMats(b) <= 10);
    if (Object.keys(b).some((k) => k.indexOf("seed_") === 0)) seeds60++;
    if (b.feather || b.shell || b.clover) finds60++;
    assert.equal(J(PW.lootOf("dX", 1000 + i, 60)), J(b));                // fixed
  }
  assert.ok(seeds60 > 120 && seeds60 < 280);
  assert.ok(finds60 > 50 && finds60 < 160);
});

test("petnest: the nest is built in order and paid once, even from two devices", () => {
  const t0 = 5000, D = PW.defaultData(), G = PW.defaultGarden();
  let pebbles = 0;
  const have = (k) => (k === "pebble" ? pebbles : 100);
  let n = PW.defaultNest();
  assert.equal(PW.buildNest(n, "n1", t0, have), n);                       // no pebbles yet
  assert.equal(PW.buildNest(n, "n2", t0, () => 100), n);                  // out of order
  assert.equal(PW.buildNest(n, "lantern", t0, () => 100), n);             // needs stage 2
  pebbles = 3;
  const A = PW.buildNest(n, "n1", t0, have), B = PW.buildNest(n, "n1", t0 + 7, have);
  const m = PW.mergeNest(A, B);
  assert.equal(PW.nestStage(m), 1);
  // the cost is derived from what is built: 3 pebbles, once
  const rich = { ver: 1, br: 0, built: {}, rows: { dA: { b: 0, v: 1, w: {}, sum: { pebble: 10, twig: 20 } } } };
  const r = PW.mergeNest(rich, m);
  assert.equal(PW.stock(D, G, "pebble", r, t0), 7);
  let full = r;
  ["n2", "n3", "n4", "n5"].forEach((id, i) => { full = PW.buildNest(full, id, t0 + i + 1, () => 100); });
  assert.equal(PW.nestStage(full), 5);
  assert.equal(PW.stock(D, G, "twig", full, t0), 20 - 8 - 6);
  assert.ok(PW.buildNest(full, "garland", t0 + 9, () => 100).built.garland);
  assert.equal(PW.buildNest(full, "n3", t0 + 9, () => 100), full);        // already built
  // a fresh start empties the nest and the walks on every device
  const fresh = PW.freshNest(full, t0 + 100);
  assert.equal(J(PW.mergeNest(full, fresh).built), "{}");
  assert.equal(J(PW.mergeNest(full, fresh).rows), "{}");
  assert.ok(PW.nestHasContent(full));
  assert.ok(!PW.nestHasContent(fresh));
  // a walk after the fresh start survives
  const later = PW.startWalk(fresh, "dB", 15, t0 + 200);
  assert.equal(PW.lastWalk(PW.mergeNest(later, full)).dev, "dB");
});

function randomGames() {
  const rows = {};
  for (let i = 0; i < rnd(4); i++) {
    const g = {};
    ["catch", "hide", "follow", "Bad!", "future_game"].forEach((k) => {
      if (rnd(2)) g[k] = rnd(8) ? { best: rnd(20), n: rnd(5) } : { best: -1, n: 1 };
    });
    rows["d" + rnd(4)] = { b: rnd(3) * 100, s: g };
  }
  return { ver: 1, br: rnd(3) ? 0 : rnd(3) * 100, rows };
}

test("petgames: merge is a join and pure", () => {
  const M = PW.mergeGames;
  for (let i = 0; i < 20000; i++) {
    const a = randomGames(), b = randomGames(), c = randomGames(), sa = J(a);
    const ab = M(a, b);
    assert.equal(J(ab), J(M(b, a)));
    assert.equal(J(M(ab, ab)), J(ab));
    assert.equal(J(M(ab, null)), J(ab));
    assert.equal(J(M(M(a, b), c)), J(M(a, M(b, c))));
    assert.equal(J(a), sa);
  }
});

test("petgames: best of every device, plays summed, a fresh start clears", () => {
  let g = PW.recordGame(PW.defaultGames(), "dA", "catch", 12);
  g = PW.recordGame(g, "dA", "catch", 7);
  const other = PW.recordGame(PW.defaultGames(), "dB", "catch", 15);
  const m = PW.mergeGames(g, other);
  assert.equal(J(PW.gameStats(m, "catch")), J({ best: 15, n: 3 }));
  assert.equal(J(PW.gameStats(m, "hide")), J({ best: 0, n: 0 }));
  assert.equal(J(PW.mergeGames(m, g)), J(m));                       // an old copy changes nothing
  assert.equal(PW.recordGame(m, "dA", "Bad!", 3), m);
  assert.equal(PW.recordGame(m, "dA", "hide", -1), m);
  assert.ok(PW.gamesHasContent(m));
  const fresh = PW.freshGames(m, 1000);
  assert.ok(!PW.gamesHasContent(PW.mergeGames(fresh, other)));
  const later = PW.recordGame(fresh, "dB", "follow", 4);
  assert.equal(PW.gameStats(PW.mergeGames(later, m), "follow").best, 4);
  // unknown games from a newer version survive an older merge
  assert.equal(J(PW.mergeGames({ rows: { dC: { b: 0, s: { future_game: { best: 2, n: 1 } } } } }, null).rows.dC.s),
               J({ future_game: { best: 2, n: 1 } }));
});

function randomProgress() {
  const days = [];
  for (let i = 0; i < rnd(6); i++) days.push(rnd(8) ? 100 + rnd(12) : ["x", -1, 1.5, null][rnd(4)]);
  const wear = rnd(3) ? { id: ["", "bow", "hat", "Bad!", "future_acc"][rnd(5)], ts: rnd(4) * 10 * 86400000 } : null;
  return { ver: 1, br: rnd(3) ? 0 : (100 + rnd(12)) * 86400000 + rnd(2) * 1000, days: rnd(8) ? days : "junk", wear };
}

test("petprogress: merge is a join and pure", () => {
  const M = PW.mergeProgress;
  for (let i = 0; i < 20000; i++) {
    const a = randomProgress(), b = randomProgress(), c = randomProgress(), sa = J(a), sb = J(b);
    const ab = M(a, b);
    assert.equal(J(ab), J(M(b, a)));
    assert.equal(J(M(ab, ab)), J(ab));
    assert.equal(J(M(ab, null)), J(ab));
    assert.equal(J(M(M(a, b), c)), J(M(a, M(b, c))));
    assert.equal(J(a), sa);
    assert.equal(J(b), sb);
    ab.days.forEach((d, k) => { assert.ok(d >= Math.floor(ab.br / PW.DAY)); if (k) assert.ok(d > ab.days[k - 1]); });
  }
  assert.equal(J(M("junk", 42)), J(PW.defaultProgress()));
});

test("petprogress: care days come from feeding and patting, once a day, and a fresh start clears them", () => {
  const D = PW.DAY, t0 = 20000 * D;
  const log = [
    { id: "1", ts: t0 + 1000, type: "feed" }, { id: "2", ts: t0 + 5000, type: "pet" },
    { id: "3", ts: t0 + D + 10, type: "sleep" },                       // not care
    { id: "4", ts: t0 + 2 * D, type: "pet" }, { id: "5", ts: "bad", type: "feed" }
  ];
  let p = PW.addCareDays(PW.defaultProgress(), log, []);
  assert.equal(J(p.days), J([20000, 20002]));
  assert.equal(PW.addCareDays(p, log, []), p);                         // nothing new: same object
  p = PW.addCareDays(p, null, [t0 + D]);
  assert.equal(J(p.days), J([20000, 20001, 20002]));
  assert.equal(PW.longestStreak(p.days), 3);
  assert.equal(PW.longestStreak([1, 2, 4, 5, 6, 9]), 3);
  assert.equal(PW.longestStreak([]), 0);
  assert.ok(PW.progressHasContent(p));
  // the other device's copy joins; a fresh start drops older days
  const other = PW.addCareDays(PW.defaultProgress(), null, [t0 + 5 * D]);
  assert.equal(PW.mergeProgress(p, other).days.length, 4);
  const fresh = PW.freshProgress(p, t0 + 2 * D + 500);
  assert.equal(J(PW.mergeProgress(fresh, p).days), J([20002]));          // the reset day itself stays
  assert.equal(J(PW.addCareDays(fresh, log, []).days), J([20002]));     // old log entries do not come back
});

test("petprogress: the newest accessory choice wins; a fresh start takes it off", () => {
  let p = PW.setWear(PW.defaultProgress(), "bow", 100);
  const q = PW.setWear(p, "hat", 50);                                  // clock behind: still newer
  assert.equal(q.wear.id, "hat");
  assert.ok(q.wear.ts > p.wear.ts);
  assert.equal(PW.mergeProgress(p, q).wear.id, "hat");
  assert.equal(PW.mergeProgress({ wear: { id: "bow", ts: 5 } }, { wear: { id: "hat", ts: 5 } }).wear.id, "hat");
  assert.equal(PW.setWear(q, "Bad!", 200), q);
  assert.equal(PW.setWear(q, "", 200).wear.id, "");
  assert.equal(PW.mergeProgress(PW.freshProgress(q, 1000), q).wear, null);
});

test("petprogress: XP, level and achievements come from the forest itself", () => {
  const H = PW.HOUR, MIN = PW.MIN, t0 = 1700000000000;
  assert.equal(PW.levelOf(0), 1);
  assert.equal(PW.levelOf(39), 1);
  assert.equal(PW.levelOf(40), 2);
  assert.equal(PW.levelOf(PW.levelXP(20)), 20);
  assert.equal(PW.levelOf(1e9), 20);
  // a forest with a harvest, a walk, two nest stages, two games and three care days
  let g = PW.plantSeed(PW.defaultGarden(), "0", "carrot", t0);
  const h = PW.harvestPlot(g, "0", t0 + 5 * H);
  g = h.g;
  let n = PW.startWalk(PW.defaultNest(), "dA", 30, t0);
  n = PW.buildNest(n, "n1", t0 + 1, () => 100);
  n = PW.buildNest(n, "n2", t0 + 2, () => 100);
  let gm = PW.recordGame(PW.defaultGames(), "dA", "catch", 26);
  gm = PW.recordGame(gm, "dB", "hide", 3);
  const pr = PW.addCareDays(PW.defaultProgress(), null, [t0, t0 + PW.DAY, t0 + 2 * PW.DAY]);
  const d = PW.defaultData();
  const st = PW.progressStats(d, g, n, gm, pr, t0 + 6 * H);
  const loot = PW.lootOf("dA", t0, 30);
  const mats = ["twig", "leaf", "moss", "pebble", "feather", "shell", "clover"].reduce((s, k) => s + (loot[k] || 0), 0);
  assert.equal(st.crops, h.got.carrot);
  assert.equal(st.gathered, mats);
  assert.equal(st.stages, 2);
  assert.equal(st.plays, 2);
  assert.equal(st.catch, 26);
  assert.equal(st.days, 3);
  assert.equal(st.streak, 3);
  const done = PW.achievementsDone(st);
  assert.ok(done.indexOf("harvest1") >= 0 && done.indexOf("catcher") >= 0 && done.indexOf("week") < 0);
  assert.equal(PW.xpOf(st), 3 * 10 + st.crops * 2 + mats + 2 * 25 + 2 * 3 + done.length * 20);
  // the walk only counts once it is over
  assert.equal(PW.progressStats(d, g, n, gm, pr, t0 + 10 * MIN).gathered, 0);
  // the same forest on another device gives the same XP
  const st2 = PW.progressStats(PW.mergeWorld(d, null), PW.mergeGarden(g, null), PW.mergeNest(PW.defaultNest(), n),
                               PW.mergeGames(gm, null), PW.mergeProgress(pr, null), t0 + 6 * H);
  assert.equal(PW.xpOf(st2), PW.xpOf(st));
  // accessories owned count for "dapper"
  let rich = PW.ledger(d, "dA", "acc_bow", 1, 0);
  rich = PW.ledger(rich, "dA", "acc_hat", 1, 0);
  rich = PW.ledger(rich, "dB", "acc_scarf", 1, 0);
  assert.equal(PW.progressStats(rich, g, n, gm, pr, t0).outfits, 3);
});

test("petprogress: beds 5 and 6 open with the level and never hide a planted bed", () => {
  const g = PW.defaultGarden();
  assert.equal(PW.bedCount(1, g), 4);
  assert.equal(PW.bedCount(4, g), 5);
  assert.equal(PW.bedCount(8, g), 6);
  assert.equal(PW.bedCount(20, g), 6);
  const planted = PW.plantSeed(g, "5", "carrot", 1000);
  assert.equal(PW.bedCount(1, planted), 6);
});

test("acorns: from games (capped), walks and harvests (fixed loot), a start purse, spent through the ledger", () => {
  assert.equal(PW.acornsFor("catch", 26), 3);
  assert.equal(PW.acornsFor("catch", 7), 0);
  assert.equal(PW.acornsFor("hide", 5), 2);
  assert.equal(PW.acornsFor("follow", 4), 2);
  assert.equal(PW.acornsFor("follow", 99), 5);
  assert.equal(PW.lootOf("dA", 1000, 15).acorn, 1);
  assert.equal(PW.lootOf("dA", 1000, 30).acorn, 2);
  assert.equal(PW.lootOf("dA", 1000, 60).acorn, 4);
  assert.equal(PW.yieldOf("0", { s: "carrot", t: 5, n: 0 }).acorn, 1);
  assert.equal(PW.yieldOf("0", { s: "apple", t: 5, n: 0 }).acorn, 2);
  const G = PW.defaultGarden();
  let d = PW.defaultData();
  assert.equal(PW.stock(d, G, "acorn"), 5);
  d = PW.ledger(d, "dA", "acorn", 3, 0);
  d = PW.ledger(d, "dA", "acorn", 0, 8);
  d = PW.ledger(d, "dA", "acc_bow", 1, 0);
  assert.equal(PW.stock(d, G, "acorn"), 0);
  assert.equal(PW.stock(d, G, "acc_bow"), 1);
  // harvest acorns are counted once even when two devices pick the same growth
  let g = PW.plantSeed(G, "1", "carrot", 0);
  const A = PW.harvestPlot(g, "1", 5 * PW.HOUR).g, B = PW.harvestPlot(g, "1", 6 * PW.HOUR).g;
  assert.equal(PW.stock(PW.defaultData(), PW.mergeGarden(A, B), "acorn"), 6);
});
