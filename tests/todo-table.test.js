// To-Do table view (TD-TBL): the column sort of todo/model.js tableSort.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const M = require(path.join(__dirname, "..", "todo/model.js"));

const A = { name: "Alpha" }, B = { name: "beta" };
const LB = { l1: "work", l2: "Home" };
const ctx = { lang: "en", labelName: (id) => LB[id] || "" };
const rows = [
  { list: B, item: { text: "pay rent", due: "2026-12-01", prio: 2, labels: ["l1"] }, i: 0 },
  { list: A, item: { text: "Call mom", labels: ["l2", "l1"] }, i: 1 },
  { list: A, item: { text: "buy milk", due: "2026-11-28", prio: 1 }, i: 2 },
  { list: B, item: { text: "Archive", due: "2026-11-01", done: true, prio: 1 }, i: 3 },
  { list: A, item: { text: "book flights", due: "2026-12-01", prio: 3 }, i: 4 }
];
const order = (k, d) => M.tableSort(rows, k, d, ctx).map((r) => r.item.text);

test("text, case- and accent-blind, both ways; done last", () => {
  assert.deepEqual(order("text", 1), ["book flights", "buy milk", "Call mom", "pay rent", "Archive"]);
  assert.deepEqual(order("text", -1), ["pay rent", "Call mom", "buy milk", "book flights", "Archive"]);
});

test("due: soonest first, no date always last, ties keep the view's order", () => {
  assert.deepEqual(order("due", 1), ["buy milk", "pay rent", "book flights", "Call mom", "Archive"]);
  assert.deepEqual(order("due", -1), ["pay rent", "book flights", "buy milk", "Call mom", "Archive"]);
});

test("priority P1 first (none = P4), list and labels by name", () => {
  assert.deepEqual(order("prio", 1), ["buy milk", "pay rent", "book flights", "Call mom", "Archive"]);
  assert.deepEqual(order("list", 1), ["Call mom", "buy milk", "book flights", "pay rent", "Archive"]);
  assert.deepEqual(order("labels", 1), ["Call mom", "pay rent", "buy milk", "book flights", "Archive"]);
});

test("an unknown column keeps the rows as they are; input untouched", () => {
  const before = rows.map((r) => r.item.text);
  assert.deepEqual(M.tableSort(rows, "nope", 1, ctx).map((r) => r.item.text), before);
  order("text", 1);
  assert.deepEqual(rows.map((r) => r.item.text), before);
  assert.deepEqual(M.TABLE_KEYS, ["text", "list", "due", "prio", "labels"]);
});
