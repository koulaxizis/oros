// Pure logic of Pet World (petworld/petworld.js): the "petworld"
// slice merge, the per-device ledger, the pet binding and a fresh
// start. Run: node --test tests/
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
  ["cmpStr", "normRow", "joinRows", "mergeWorld", "defaultData", "itemCount",
   "worldHasContent", "ledger", "freshStart", "bindPet"],
  [["  var DATA_VER", "  var WAKE_AT"]],
  "mergeWorld, defaultData, itemCount, worldHasContent, ledger, freshStart, bindPet");

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
  assert.equal(PW.itemCount(m, "acorn"), 6);
  assert.equal(PW.itemCount(m, "twig"), 0);
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
  assert.equal(PW.itemCount(PW.mergeWorld(later, fresh), "twig"), 1);
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
