// Places shared with a household (maps/hh-core.js, BR-HH): one item
// per place with an id from its coordinates, so the same place added
// by two people is one place; a place is whole in one value; nothing
// new is never sent; the own copy keeps the note.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../maps/hh-core.js");
const C = require("../household/core.js");

const SHOP = { lat: 37.983810, lon: 23.727539, name: "Bakery", sub: "Athens", note: "Closed on Sundays\nside door" };

test("a place becomes one item and comes back the same", () => {
  const c = M.change(null, SHOP);
  assert.deepEqual(Object.keys(c.set), ["p:37983810_23727539"]);
  const doc = C.apply(C.empty("places"), c, 10, "m1");
  const got = M.build(C.view(doc));
  assert.equal(got.length, 1);
  assert.equal(got[0].note, "Closed on Sundays\nside door");
  assert.equal(got[0].by, "m1");
  assert.equal(M.change(C.view(doc), got[0]), null);            // nothing new: nothing to send
});

test("the same place added by two people at once is one place; the newer whole value wins", () => {
  const a = C.apply(C.empty("places"), M.change(null, SHOP), 10, "m1");
  const b = C.apply(C.empty("places"), M.change(null, Object.assign({}, SHOP, { name: "Best bakery", note: "" })), 11, "m2");
  const m = C.merge(a, b);
  assert.deepEqual(m, C.merge(b, a));
  const got = M.build(C.view(m));
  assert.equal(got.length, 1);
  assert.equal(got[0].name, "Best bakery");
  assert.equal(got[0].note, "");
});

test("bad values are cleaned or left out; an item whose id does not match its place is left out", () => {
  const doc = C.apply(C.empty("places"), { set: {
    "p:1000000_2000000": { v: { lat: 1, lon: 2, name: "x\u0000y".repeat(100), note: "n".repeat(900) } },
    "p:5000000_5000000": { v: { lat: 1, lon: 2, name: "moved" } },
    "p:9_9": { v: { lat: 200, lon: 2, name: "bad" } },
    "zz": { v: { lat: 1, lon: 2 } }
  } }, 10, "m1");
  const got = M.build(C.view(doc));
  assert.equal(got.length, 1);
  assert.equal(got[0].name.length, 120);
  assert.equal(got[0].note.length, 500);
  assert.equal(M.valueOf({ lat: 1 }), null);
});

test("the own copy keeps the note after the name's details", () => {
  const doc = C.apply(C.empty("places"), M.change(null, SHOP), 10, "m1");
  assert.deepEqual(M.copyOf(C.view(doc)), [{ name: "Bakery", sub: "Athens · Closed on Sundays side door", lat: 37.98381, lon: 23.727539 }]);
});
