// To-Do "send to To-Do" receiver (todo/todo.js section 13, BR-TD-ADD):
// the payload reader that every sending app depends on. The dialog
// and the write itself are checked in the real shell.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "todo", "todo.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const R = new Function(
  block("  function normalize(s) {", "  // ISO date") +
  block("  var ADD_MAX", "  function openKeysOf") +
  "\nreturn { readAddPayload, ADD_MAX, ADD_TEXT, ADD_NOTE };")();

test("valid payload: fields kept, text cleaned", () => {
  const p = R.readAddPayload({ list: "tdl-groceries", from: " Meal\nPlanner ", newList: "Rome",
    items: [{ text: "  200 g  feta\t", note: "for Horiatiki\nand pie" }] });
  assert.deepEqual(p, { list: "tdl-groceries", newList: "Rome", from: "Meal Planner",
    items: [{ text: "200 g feta", note: "for Horiatiki\nand pie" }] });
});

test("rejects what is not a payload", () => {
  [null, undefined, "x", 5, {}, { items: "a" }, { items: [] }, { items: [{ text: "  " }, null, 7, { text: 3 }] }]
    .forEach((x) => assert.equal(R.readAddPayload(x), null, JSON.stringify(x)));
});

test("duplicates inside the payload collapse (case, accents, punctuation)", () => {
  const p = R.readAddPayload({ items: [{ text: "Φέτα" }, { text: "φετα" }, { text: "Feta!" }, { text: "feta" }] });
  assert.deepEqual(p.items.map((i) => i.text), ["Φέτα", "Feta!"]);
});

test("limits: item count, text and note length, control characters", () => {
  const many = Array.from({ length: R.ADD_MAX + 50 }, (_, i) => ({ text: "item " + i }));
  assert.equal(R.readAddPayload({ items: many }).items.length, R.ADD_MAX);
  const p = R.readAddPayload({ items: [{ text: "a".repeat(R.ADD_TEXT + 9) + "\u0000 ", note: "n".repeat(R.ADD_NOTE + 9) }] });
  assert.equal(p.items[0].text.length, R.ADD_TEXT);
  assert.equal(p.items[0].note.length, R.ADD_NOTE);
  assert.equal(R.readAddPayload({ items: [{ text: "a b\u0007c" }] }).items[0].text, "a b c");
});

test("non-string optional fields become empty, markup stays plain text", () => {
  const p = R.readAddPayload({ list: 4, newList: {}, from: [], items: [{ text: "<b>x</b>", note: 9 }] });
  assert.deepEqual(p, { list: "", newList: "", from: "", items: [{ text: "<b>x</b>", note: "" }] });
});
