// CRM 1.9: linked items (ix rows) — Kanban cards, Notes pages, Layout
// and Atelier documents on a partner's card (crm/core.js normIx).
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../crm/core.js");

const T0 = 1790000000000;
const J = (x) => JSON.stringify(x);
function base() {
  const d = C.empty();
  d.cust.push({ id: "c1aaaaaaaa", m: T0, name: "Ann", kind: "person", st: "active" });
  return d;
}

test("ix: rows cleaned (kinds, refs, titles, duplicates), sorted, merge symmetric, gone customer drops its row", () => {
  const a = base(), b = base();
  a.ix = [{ id: "c1aaaaaaaa", m: T0 + 1, it: [{ k: "nt", r: "p1", t: " Notes  " }, { k: "kb", r: "b1/c1/k1" }, { k: "kb", r: "b1/c2/k1" }, { k: "zz", r: "x" }, { k: "ly", r: "a/b" }, { k: "at", r: "d<1" }] }];
  b.ix = [{ id: "c1aaaaaaaa", m: T0 + 2, it: [{ k: "at", r: "des1", t: "Cover" }] }];
  const n = C.norm(a);
  assert.deepEqual(n.ix, [{ id: "c1aaaaaaaa", m: T0 + 1, it: [{ k: "kb", r: "b1/c1/k1" }, { k: "nt", r: "p1", t: "Notes" }] }]);
  assert.equal(J(C.merge(a, b)), J(C.merge(b, a)));
  assert.deepEqual(C.merge(a, b).ix[0].it, [{ k: "at", r: "des1", t: "Cover" }], "newer row wins");
  // an emptied row stays; without customers the row goes
  const e = base(); e.ix = [{ id: "c1aaaaaaaa", m: T0 + 3 }];
  assert.deepEqual(C.merge(a, e).ix, [{ id: "c1aaaaaaaa", m: T0 + 3 }]);
  const g = C.empty(); g.ix = a.ix;
  assert.equal(C.norm(g).ix, undefined);
  // data without items keeps its bytes
  assert.equal(C.norm(base()).ix, undefined);
  assert.deepEqual(C.itemTarget({ k: "nt", r: "p1" }), { app: "notes", target: { page: "p1" } });
  assert.deepEqual(C.itemTarget({ k: "ly", r: "doc1" }), { app: "layout", target: { doc: "doc1" } });
  assert.equal(C.itemTarget({ k: "kb", r: "bad" }), null);
});
