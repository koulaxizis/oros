// Habits Assistant entry card (BR-W8-6): M.asNew cleans the shell's
// { asNew } payload for the new-habit dialog (habits/model.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const M = require(path.join(__dirname, "..", "habits/model.js"));

test("habits asNew: name required, plain habit", () => {
  assert.equal(M.asNew(null), null);
  assert.equal(M.asNew({ unit: "km" }), null);
  assert.deepEqual(M.asNew({ name: "  Read\u0000 ", foo: 1 }), { name: "Read", days: [], per: null, num: null, rem: -1 });
  assert.equal(M.asNew({ name: "x".repeat(300) }).name.length, 200);
});

test("habits asNew: days, per, number target, reminder", () => {
  const v = M.asNew({ name: "Run", days: [4, 0, 0, 9, "1", 2.5, 6], target: 5.555, unit: " km ", cmp: "le", reminder: "07:30" });
  assert.deepEqual(v.days, [0, 4, 6]);
  assert.deepEqual(v.num, { t: 5.56, u: "km", c: "le" });
  assert.equal(v.rem, 450);
  assert.deepEqual(M.asNew({ name: "Gym", perWeek: 3, days: [1] }), { name: "Gym", days: [], per: ["w", 3], num: null, rem: -1 });
  assert.deepEqual(M.asNew({ name: "G", perMonth: 31 }).per, ["m", 31]);
  assert.equal(M.asNew({ name: "G", perWeek: 8 }).per, null);
  assert.deepEqual(M.asNew({ name: "W", unit: "glasses" }).num, { t: 0, u: "glasses", c: "ge" });
  assert.equal(M.asNew({ name: "W", target: -1 }).num, null);
  assert.equal(M.asNew({ name: "W", target: Infinity }).num, null);
  assert.equal(M.asNew({ name: "W", reminder: "24:00" }).rem, -1);
  assert.equal(M.asNew({ name: "W", reminder: "7:05" }).rem, 425);
});
