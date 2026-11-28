// DICT-1: Montage › Remove silences (core cutRanges).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const C = require(path.join(__dirname, "..", "montage/core.js"));

const T0 = 1760000000000;
const H = (c) => c.repeat(64);
const VID = H("a") + ".mp4", PIC = H("c") + ".jpg";
const empty = () => C.merge(null, null);
let n = 0;
const mk = () => "x" + (++n);

function base() {
  let d = C.newProject(empty(), { name: "Talk", ar: "16:9" }, T0, "p1");
  d = C.addItem(d, "p1", { id: "v1", k: "video", tr: "main", src: VID, len: 30, in: 0, out: 20 }, T0 + 1);
  d = C.addItem(d, "p1", { id: "i1", k: "image", tr: "main", src: PIC, d: 4 }, T0 + 2);
  d = C.addItem(d, "p1", { id: "t1", k: "title", tr: "tt", at: 12, d: 2, text: { t: "hi" } }, T0 + 3);
  return d;
}
const total = (d) => C.duration(d.projects.p1);

test("cuts silences inside a clip and moves the text after them", () => {
  const r = C.cutRanges(base(), "p1", [{ start: 0, end: 1 }, { start: 5, end: 7 }, { start: 10, end: 11.5 }, { start: 19, end: 20 }], T0 + 10, mk);
  assert.equal(r.n, 4);
  assert.equal(r.removed, 5.5);
  assert.equal(total(r.data), 24 - 5.5);
  const p = r.data.projects.p1;
  // pieces of the clip, in order, with the right source ranges
  const vids = C.mainSeq(p).filter((s) => s.it.k === "video").map((s) => [s.it.in, s.it.out]);
  assert.deepEqual(vids, [[1, 5], [7, 10], [11.5, 19]]);
  // the text at 12 s: 1 + 2 + 1.5 s removed before it
  assert.equal(p.items.t1.at, 7.5);
  // the image clip was not touched
  assert.ok(p.items.i1);
});

test("a clip with no speech, images, muted clips and transitions are left alone", () => {
  let d = base();
  const all = C.cutRanges(d, "p1", [{ start: 0, end: 24 }], T0 + 10, mk);
  assert.equal(all.n, 0);
  d = C.setItem(d, "p1", "v1", { mu: true }, T0 + 5);
  assert.equal(C.cutRanges(d, "p1", [{ start: 5, end: 7 }], T0 + 10, mk).n, 0);
  // cut only inside the chosen clip
  assert.equal(C.cutRanges(base(), "p1", [{ start: 5, end: 7 }], T0 + 10, mk, { only: "i1" }).n, 0);
  assert.equal(C.cutRanges(base(), "p1", [], T0 + 10, mk).n, 0);
});

test("very short pieces are not made", () => {
  const r = C.cutRanges(base(), "p1", [{ start: 5, end: 5.05 }], T0 + 10, mk);
  assert.equal(r.n, 0);
});
