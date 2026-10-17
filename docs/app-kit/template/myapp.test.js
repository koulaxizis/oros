// My App: the data model's sync rules (OROS_BIBLE.md Part I, R5/R17/R26).
// new-app.js copies this file to tests/<id>.test.js.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../myapp/core.js");

const A = () => C.add(C.add(C.empty(), "milk", 100, "a"), "bread", 110, "b");
const B = () => C.remove(C.update(A(), "a", { done: true }, 200), "b", 210);

test("merge is symmetric and settles at once", () => {
  const ab = C.serialize(C.merge(A(), B())), ba = C.serialize(C.merge(B(), A()));
  assert.equal(ab, ba);
  assert.equal(C.serialize(C.merge(JSON.parse(ab), B())), ab);
  assert.equal(C.serialize(C.merge(B(), B())), C.serialize(B()));
});

test("a delete wins over an older edit, a newer edit brings the item back", () => {
  const del = C.remove(A(), "a", 300);
  assert.deepEqual(C.live(C.merge(A(), del)).map((x) => x.id), ["b"]);
  const edited = C.update(A(), "a", { text: "oat milk" }, 400);
  assert.deepEqual(C.live(C.merge(del, edited)).map((x) => x.text).sort(), ["bread", "oat milk"]);
});

test("broken input is dropped, never repaired with a fresh id or time", () => {
  const d = C.normalize({ items: [{ text: "no id" }, null, { id: "x", text: 5, mtime: "y" }], tombs: { z: "bad" } });
  assert.deepEqual(d, { ver: 1, items: [{ id: "x", text: "", done: false, mtime: 0 }], tombs: {} });
});

test("the search provider skips deleted items", () => {
  const P = require("../myapp/search.js");
  const d = JSON.parse(C.serialize(C.merge(A(), B())));
  const hits = P.search({ readJSON: () => d });
  assert.deepEqual(hits.map((h) => h.target.item), ["a"]);
});
