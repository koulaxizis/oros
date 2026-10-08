// Pure logic of Pet World (petworld/petworld.js): the "petworld"
// slice merge, the per-device ledger, the pet binding, a fresh start,
// and the "petgarden" slice (beds, growth, watering, harvests). Run: node --test tests/
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
   "freshGarden", "stock", "gardenHasContent", "clamp"],
  [["  var DATA_VER", "  var WAKE_AT"], ["  var HOUR", "  function normTot("]],
  "mergeWorld, defaultData, worldHasContent, ledger, freshStart, bindPet, mergeGarden, " +
  "defaultGarden, plotState, plantSeed, waterPlot, harvestPlot, digUp, freshGarden, stock, " +
  "gardenHasContent, CROPS, START_PACK, HOUR");

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
  assert.equal(PW.stock(m, G0, "acorn"), 6);
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
