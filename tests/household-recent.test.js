// What the others changed in a household (household/recent.js, BR-HH):
// counts per member and document, the person's own changes left out,
// one bell line per burst (after 10 quiet minutes or an hour), the
// Today row per household, device-local and bounded.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../household/recent.js");
const C = require("../household/core.js");

const BOX = "AAAAAAAAAAAAAAAAAAAAAA";
const names = { m1: "Anna", m2: "Nikos" };
const nameOf = (mid) => names[mid] || "";

function base() {
  return C.apply(C.empty("list"), { set: { a: { n: "milk" }, b: { n: "bread" } }, m: { t: "Shopping" } }, 10, "m1");
}

test("summarize counts added, changed and removed items per member, not mine", () => {
  const prev = base();
  let next = C.apply(prev, { set: { c: { n: "eggs" }, d: { n: "tea" }, a: { n: "oat milk" } } }, 20, "m2");
  next = C.apply(next, { del: ["b"] }, 21, "m2");
  next = C.apply(next, { set: { e: { n: "salt" } } }, 22, "m1");
  const s = R.summarize(prev, next, "m1");
  assert.deepEqual(s, { by: { m2: { a: 2, c: 1 } }, d: 1 });
  assert.equal(R.summarize(prev, prev, "m1"), null);
  // "who am I" items are nobody's news
  assert.equal(R.summarize(prev, C.apply(prev, { set: { "me:m2": { v: "x" } } }, 30, "m2"), "m1"), null);
  // only my own changes (another device of mine): nothing
  assert.equal(R.summarize(prev, C.apply(prev, { set: { z: { n: "x" } } }, 30, "m1"), "m1"), null);
});

test("a burst rings once, after 10 quiet minutes, as one line", () => {
  const st = R.load(null);
  const prev = base();
  const n1 = C.apply(prev, { set: { c: { n: "eggs" } } }, 20, "m2");
  R.add(st, BOX, "Home", "doc1", "Shopping", R.summarize(prev, n1, "m1"), nameOf, 1000);
  const n2 = C.apply(n1, { set: { d: { n: "tea" } }, del: ["a"] }, 30, "m2");
  R.add(st, BOX, "Home", "doc1", "Shopping", R.summarize(n1, n2, "m1"), nameOf, 1000 + 5 * 60000);
  R.add(st, BOX, "Home", "doc2", "Calendar", { by: { m1: { a: 0, c: 2 } }, d: 0 }, nameOf, 1000 + 6 * 60000);
  assert.deepEqual(R.due(st, 1000 + 10 * 60000), []);                       // not quiet yet
  const due = R.due(st, 1000 + 16 * 60000 + 1);
  assert.equal(due.length, 1);
  assert.equal(due[0].body, "Shopping: Nikos +2, \u22121 · Calendar: Anna ~2");
  assert.equal(due[0].hh, "Home");
  assert.equal(due[0].from, 1000);
  assert.deepEqual(R.due(st, 1000 + 30 * 60000), []);                       // rung once
});

test("a long burst rings after an hour even without a pause", () => {
  const st = R.load(null);
  for (let i = 0; i <= 13; i++) R.add(st, BOX, "Home", "d", "List", { by: { m2: { a: 1, c: 0 } }, d: 0 }, nameOf, 1 + i * 5 * 60000);
  const due = R.due(st, 65 * 60000);
  assert.equal(due.length, 1);
  assert.equal(due[0].body, "List: Nikos +14");
});

test("today: one row per household with what changed since the start of the day", () => {
  const st = R.load(null);
  R.add(st, BOX, "Home", "d", "Shopping", { by: { m2: { a: 3, c: 1 } }, d: 0 }, nameOf, 500);
  R.add(st, BOX, "Home", "d", "Shopping", { by: { m2: { a: 1, c: 0 } }, d: 0 }, nameOf, 2000);
  assert.deepEqual(R.today(st, 1000), [{ box: BOX, hh: "Home", text: "Shopping: Nikos +1" }]);
  assert.deepEqual(R.today(st, 100), [{ box: BOX, hh: "Home", text: "Shopping: Nikos +4 ~1" }]);
});

test("the store is bounded, survives JSON and drops odd input", () => {
  let st = R.load(null);
  for (let i = 0; i < R.EV_MAX + 50; i++) R.add(st, BOX, "Home", "d", "L", { by: { m2: { a: 1, c: 0 } }, d: 0 }, nameOf, 1e12 + i);
  assert.equal(st.b[BOX].ev.length, R.EV_MAX);
  st = R.load(JSON.parse(JSON.stringify(st)));
  assert.equal(st.b[BOX].ev.length, R.EV_MAX);
  R.prune(st, 1e12 + R.KEEP_MS + R.EV_MAX + 100);
  assert.equal(st.b[BOX].ev.length, 0);
  assert.deepEqual(R.load({ b: { "bad box": { ev: [] }, [BOX]: { ev: [[1, "x"]] } } }).b[BOX].ev, []);
  assert.deepEqual(R.load("nope"), { v: 1, b: {} });
});
