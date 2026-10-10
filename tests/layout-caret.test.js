// orOS Layout — caret geometry for in-frame typing (layout/caret.js)
// and the character offsets designkit/text.js puts on every line.
// Run: node --test tests/layout-caret.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "designkit/text.js"));
const M = require(path.join(ROOT, "designkit/model.js"));
const R = require(path.join(ROOT, "designkit/render.js"));
const C = require(path.join(ROOT, "layout/caret.js"));

T.allKeys().forEach((k) => {
  const b = fs.readFileSync(path.join(ROOT, "vendor/noto", T.fontFile(k)));
  T.register(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

const WORDS = "Το κείμενο ρέει από στήλη σε στήλη, lorem ipsum dolor. ".repeat(20);
function doc() {
  const d = M.newDoc({ name: "Caret", w: M.preset("a5").w, h: M.preset("a5").h, pages: 2, facing: 0 }, 1000);
  const pg = M.pagesInOrder(d);
  d.stories.push({ id: "st-a", m: 1000, paras: [
    { ps: "ps-h1", runs: [{ t: "Καλημέρα " }, { t: "κόσμε", b: 1 }] },
    { ps: "ps-body", runs: [{ t: WORDS }] },
    { ps: "ps-body", runs: [{ t: "Σελίδα " }, { f: "pn" }, { t: " τέλος\nνέα γραμμή" }] },
    { ps: "ps-body", runs: [] }
  ] });
  d.items.push({ id: "it-a", m: 1000, t: "text", pg: pg[0].id, x: 30, y: 40, w: 220, h: 200, story: "st-a", seq: 1, cols: 2, gut: 10, z: 1 });
  d.items.push({ id: "it-b", m: 1000, t: "text", pg: pg[1].id, x: 30, y: 40, w: 220, h: 400, story: "st-a", seq: 2, rot: 10, z: 1 });
  return M.normDoc(d);
}
const plen = (p) => C.paraText(p).length;

test("text.js: every line knows its paragraph and character range", () => {
  const d = doc(), L = R.computeLayout(d), ls = C.flow(d, L, "st-a"), paras = M.story(d, "st-a").paras;
  assert.ok(ls.length > 10);
  assert.ok(ls.some((l) => l.fid === "it-a") && ls.some((l) => l.fid === "it-b"), "the text runs through the thread");
  for (let i = 0; i < ls.length; i++) {
    const ln = ls[i].ln, next = ls[i + 1] && ls[i + 1].ln;
    assert.ok(ln.o0 <= ln.o1, "o0 <= o1");
    if (next && next.p === ln.p) assert.equal(next.o0, ln.o1, "lines of a paragraph are contiguous");
    else assert.equal(ln.o1, plen(paras[ln.p]), "a paragraph's last line ends at its length");
    // each run shows the characters at its offsets (lower case here)
    ln.runs.filter((r) => r.o !== undefined && !r.f).forEach((r) => {
      assert.equal(r.t, C.paraText(paras[ln.p]).slice(r.o, r.o + r.n));
    });
  }
  // the empty last paragraph still has a line to put the caret on
  assert.ok(ls.some((l) => l.ln.p === 3));
  // the forced line break splits paragraph 2 into two lines
  assert.ok(ls.filter((l) => l.ln.p === 2).length >= 2);
});

test("caret: locate then hit lands on the same position", () => {
  const d = doc(), L = R.computeLayout(d), ls = C.flow(d, L, "st-a"), paras = M.story(d, "st-a").paras;
  let checked = 0;
  ls.forEach((l) => {
    const ln = l.ln;
    for (let o = ln.o0; o < ln.o1; o += 3) {
      const pos = { p: ln.p, o: o }, loc = C.locate(ls, pos);
      assert.ok(loc, "visible position " + JSON.stringify(pos));
      assert.equal(loc.fid, l.fid);
      assert.ok(loc.top < loc.bottom);
      const back = C.hit(ls, loc.fid, loc.x, (loc.top + loc.bottom) / 2);
      assert.equal(back.p, pos.p);
      // a space and the character after it can share an x
      assert.ok(Math.abs(C.xOf(ln, back.o) - loc.x) < 0.01, "same x for " + JSON.stringify(pos) + " got " + back.o);
      checked++;
    }
  });
  assert.ok(checked > 50);
  // a point below the text of the right column goes to the frame's last line
  const lastA = ls.filter((l) => l.fid === "it-a").pop().ln;
  const h = C.hit(ls, "it-a", 200, 10000);
  assert.equal(h.p, lastA.p);
  assert.ok(h.o >= lastA.o0 && h.o <= lastA.o1);
  void paras;
});

test("caret: x grows along a line and the end of a paragraph is reachable", () => {
  const d = doc(), L = R.computeLayout(d), ls = C.flow(d, L, "st-a"), paras = M.story(d, "st-a").paras;
  const ln = ls[0].ln;
  let prev = -1;
  for (let o = ln.o0; o <= ln.o1; o++) { const x = C.xOf(ln, o); assert.ok(x >= prev - 0.001); prev = x; }
  const end = { p: 1, o: plen(paras[1]) }, loc = C.locate(ls, end);
  assert.ok(loc);
  const lnEnd = ls[loc.i].ln;
  assert.equal(lnEnd.p, 1);
  assert.equal(lnEnd.o1, end.o);
  // an overset position has no caret box
  const small = doc();
  small.items = small.items.filter((it) => it.id === "it-a");
  const L2 = R.computeLayout(small), ls2 = C.flow(small, L2, "st-a");
  assert.equal(C.locate(ls2, { p: 3, o: 0 }), null);
});

test("caret: up / down keep the goal x, home / end, word and step", () => {
  const d = doc(), L = R.computeLayout(d), ls = C.flow(d, L, "st-a"), paras = M.story(d, "st-a").paras;
  const bodyLines = ls.map((l, i) => [l, i]).filter((x) => x[0].ln.p === 1);
  const [first, i0] = bodyLines[1];
  const pos = { p: 1, o: first.ln.o0 + 4 }, x = C.locate(ls, pos).x;
  const down = C.lineMove(ls, pos, 1, x);
  assert.equal(C.locate(ls, down).i, i0 + 1);
  const up = C.lineMove(ls, down, -1, x);
  assert.deepEqual(up, pos);
  assert.equal(C.lineMove(ls, { p: 0, o: 0 }, -1, 0), null);
  assert.deepEqual(C.lineEdge(ls, pos, -1), { p: 1, o: first.ln.o0 });
  const e = C.lineEdge(ls, pos, 1);
  assert.equal(e.o, first.ln.o1 - 1, "End stops before the wrapping space");
  // words: Greek, Latin, punctuation
  const w = C.word(paras, { p: 0, o: 2 });
  assert.deepEqual([w.a.o, w.b.o], [0, 8]);
  assert.equal(C.paraText(paras[0]).slice(w.a.o, w.b.o), "Καλημέρα");
  assert.deepEqual(C.step(paras, { p: 0, o: 0 }, 1, true), { p: 0, o: 8 });
  assert.deepEqual(C.step(paras, { p: 0, o: 14 }, -1, true), { p: 0, o: 9 });
  assert.deepEqual(C.step(paras, { p: 1, o: 0 }, -1, false), { p: 0, o: 14 });
  assert.deepEqual(C.step(paras, { p: 0, o: 14 }, 1, false), { p: 1, o: 0 });
  assert.deepEqual(C.step(paras, { p: 0, o: 0 }, -1, false), { p: 0, o: 0 });
  // a field is one character
  assert.equal(C.paraText(paras[2]).indexOf("\uFFFC"), 7);
  assert.ok(C.cmp({ p: 1, o: 0 }, { p: 0, o: 99 }) > 0);
});
