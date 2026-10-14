// Kanban Assistant entry card (BR-W8-6): T.asNew cleans the shell's
// { asNew } payload for the quick-add prefill (kanban/tools.js).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const T = require(path.join(__dirname, "..", "kanban/tools.js"));

test("kanban asNew: title required, strings cleaned and capped", () => {
  assert.equal(T.asNew(null), null);
  assert.equal(T.asNew({ note: "x" }), null);
  assert.equal(T.asNew({ title: " \u0000 \n " }), null);
  const v = T.asNew({ board: "  Work\u0007 ", column: " To  Do ", title: "Call\tBob\n", note: "a\r\nb\u0000", due: "2026-10-20", x: 1 });
  assert.deepEqual(v, { board: "Work", column: "To Do", title: "Call Bob", notes: "a\nb", due: "2026-10-20" });
  assert.equal(T.asNew({ title: "x".repeat(900) }).title.length, 500);
  assert.equal(T.asNew({ title: "t", description: "d" }).notes, "d");
});

test("kanban asNew: due must be a real date", () => {
  assert.equal(T.asNew({ title: "t", due: "2026-02-30" }).due, "");
  assert.equal(T.asNew({ title: "t", due: "20261020" }).due, "");
  assert.equal(T.asNew({ title: "t", due: 5 }).due, "");
  assert.equal(T.asNew({ title: "t", due: "2028-02-29" }).due, "2028-02-29");
});
