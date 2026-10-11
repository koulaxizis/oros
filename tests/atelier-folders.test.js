// Atelier folders (atelier/folders.js): the synced record that puts
// designs into folders, its merge and its mutations.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const FO = require(path.join(__dirname, "..", "atelier/folders.js"));

test("folders: add, move, folderOf, rename", () => {
  let { r, id } = FO.add(FO.empty(), "  Canva imports ", 1000);
  assert.match(id, /^af-[a-z0-9]+$/);
  assert.equal(r.folders[0].nm, "Canva imports");
  r = FO.move(r, ["doc-a1", "doc-b2", "bad id"], id, 1001);
  assert.equal(FO.folderOf(r, "doc-a1"), id);
  assert.equal(FO.folderOf(r, "doc-b2"), id);
  assert.equal(r.place["bad id"], undefined);
  assert.equal(FO.folderOf(r, "doc-zz"), "");
  r = FO.rename(r, id, "Posts", 1002);
  assert.equal(r.folders[0].nm, "Posts");
  assert.equal(FO.add(r, "   ", 1003).id, "");                     // a name is required
  r = FO.move(r, ["doc-a1"], "", 1004);
  assert.equal(FO.folderOf(r, "doc-a1"), "");
  assert.equal(FO.move(r, ["doc-a1"], "af-missing1", 1005).place["doc-a1"].f, "");   // unknown folder: no change
});

test("folders: deleting a folder keeps its designs (back to no folder)", () => {
  let { r, id } = FO.add(FO.empty(), "Old", 1000);
  r = FO.move(r, ["doc-a1"], id, 1001);
  r = FO.remove(r, id, 2000);
  assert.deepEqual(r.folders, []);
  assert.equal(r.dt[id], 2000);
  assert.equal(FO.folderOf(r, "doc-a1"), "");
  // an older copy of the folder from another device does not bring it back
  const other = { ver: 1, folders: [{ id, m: 1500, nm: "Old", pos: 1 }], place: { "doc-a1": { f: id, m: 1001 } }, dt: {} };
  const m = FO.merge(r, other);
  assert.deepEqual(m.folders, []);
  assert.equal(FO.folderOf(m, "doc-a1"), "");
});

test("folders: merge is per entry, newer wins, same result both ways", () => {
  const a = { ver: 1, folders: [{ id: "af-aaaaaa", m: 10, nm: "A", pos: 1 }], place: { "doc-x1": { f: "af-aaaaaa", m: 20 } }, dt: {} };
  const b = { ver: 1, folders: [{ id: "af-aaaaaa", m: 30, nm: "A2", pos: 1 }, { id: "af-bbbbbb", m: 5, nm: "B", pos: 2 }],
              place: { "doc-x1": { f: "af-bbbbbb", m: 25 }, "doc-y2": { f: "af-aaaaaa", m: 1 } }, dt: {} };
  const ab = FO.merge(a, b), ba = FO.merge(b, a);
  assert.deepEqual(ab, ba);
  assert.equal(JSON.stringify(ab), JSON.stringify(ba));
  assert.deepEqual(ab.folders.map((f) => f.nm), ["A2", "B"]);
  assert.equal(FO.folderOf(ab, "doc-x1"), "af-bbbbbb");
  assert.equal(FO.folderOf(ab, "doc-y2"), "af-aaaaaa");
  // equal stamps: both sides pick the same entry
  const c = { folders: [{ id: "af-cccccc", m: 7, nm: "One", pos: 1 }] }, d = { folders: [{ id: "af-cccccc", m: 7, nm: "Two", pos: 1 }] };
  assert.deepEqual(FO.merge(c, d), FO.merge(d, c));
});

test("folders: norm drops junk", () => {
  const n = FO.norm({ folders: [{ id: "x", m: 1, nm: "a" }, { id: "af-dddddd", m: 0, nm: "a" }, { id: "af-eeeeee", m: 3, nm: "\u0001  " }, null],
                      place: { "doc-a1": { f: "<script>", m: 3 }, "doc-b1": "x", "../x": { f: "", m: 1 } }, dt: { "x": 5 } });
  assert.deepEqual(n, { ver: 1, folders: [], place: { "doc-a1": { f: "", m: 3 } }, dt: {} });
  assert.deepEqual(FO.norm(null), FO.empty());
});
