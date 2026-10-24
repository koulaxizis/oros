// An app's whole data as one household document (household/whole.js,
// BR-HH wave 7): a built document projects back to itself (no endless
// uploads), ids and keys the item id cannot hold travel hashed, long
// records travel in chunks that never mix between two people, chunks
// that do not add up are kept and never deleted, stamps become m.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../household/core.js");
const Wh = require("../household/whole.js");

// A small app: notes (list), marks by day (map), settings (one).
function merge(a, b) {
  const out = { ver: 1, ns: [], mk: {}, set: { m: 0, c: "" }, tombs: {} };
  const ns = {}, mk = {};
  [a || {}, b || {}].forEach((s) => {
    (s.ns || []).forEach((x) => { if (x && x.id && (!ns[x.id] || x.m > ns[x.id].m)) ns[x.id] = x; });
    Object.keys(s.mk || {}).forEach((k) => { const x = s.mk[k]; if (!mk[k] || x.m > mk[k].m) mk[k] = x; });
    if (s.set && s.set.m > out.set.m) out.set = s.set;
  });
  out.ns = Object.keys(ns).sort().map((id) => ns[id]);
  Object.keys(mk).sort().forEach((k) => { out.mk[k] = mk[k]; });
  return JSON.parse(JSON.stringify(out));
}
const W = Wh.make({
  parts: [{ k: "ns", t: "list", p: "n" }, { k: "mk", t: "map", p: "mk" }, { k: "set", t: "one", p: "set" }],
  merge, empty: () => merge(null, null)
});
const data = () => merge({
  ns: [{ id: "a1", m: 3, t: "Milk" }, { id: "b 2|x", m: 3, t: "odd id" }],
  mk: { "2026-10-24|d": { m: 4, v: 1 }, "σπίτι": { m: 4, v: 0 } },
  set: { m: 2, c: "blue" }
}, null);
function share(d, t, by) { return C.apply(C.empty("x"), { set: W.project(d).items }, t, by); }
function edit(doc, after, t, by) {
  const r = W.push(W.fromDoc(C.view(doc)), after, null, W.build(C.view(doc)).raw);
  return r.diff ? C.apply(doc, { set: r.diff.set, del: r.diff.del }, t, by) : doc;
}

test("a built document projects back to itself; stamps become m", () => {
  const doc = share(data(), 10, "m1");
  const b = W.build(C.view(doc));
  assert.equal(b.data.ns.length, 2);
  assert.equal(b.data.ns.find((x) => x.id === "b 2|x").t, "odd id");
  assert.equal(b.data.mk["σπίτι"].v, 0);
  assert.equal(b.data.mk["2026-10-24|d"].m, 10);
  assert.equal(b.data.set.c, "blue");
  assert.equal(b.by.a1, "m1");
  assert.equal(W.push(W.fromDoc(C.view(doc)), b.data, null, b.raw).diff, null);
  // hashed ids are item-safe
  Object.keys(W.project(data()).items).forEach((id) => assert.match(id, /^[A-Za-z0-9_:-]{1,72}$/));
});

test("an edit sends only what changed; a removal deletes the item", () => {
  const doc = share(data(), 10, "m1");
  const b = W.build(C.view(doc));
  const next = JSON.parse(JSON.stringify(b.data));
  next.ns = next.ns.filter((x) => x.id !== "a1");
  next.mk["σπίτι"] = { m: 11, v: 1 };
  const r = W.push(W.fromDoc(C.view(doc)), next, null, b.raw);
  assert.deepEqual(r.diff.del, ["n:a1"]);
  assert.equal(Object.keys(r.diff.set).length, 1);
  const doc2 = C.apply(doc, { set: r.diff.set, del: r.diff.del }, 11, "m2");
  const b2 = W.build(C.view(doc2));
  assert.equal(b2.data.ns.length, 1);
  assert.equal(b2.data.mk["σπίτι"].v, 1);
  assert.equal(b2.by["σπίτι"], "m2");
});

test("a long record travels in chunks and comes back whole", () => {
  const long = "Στίχος \"με\" εισαγωγικά. ".repeat(1500);
  const d = data(); d.ns.push({ id: "big", m: 3, t: long });
  const doc = share(d, 10, "m1");
  const it = C.view(doc).items.find((x) => x.id === "n:big");
  assert.ok(it.z0 && it.z1 && it.v.z >= 2);
  Object.keys(doc.it["n:big"]).forEach((f) => assert.ok(JSON.stringify(doc.it["n:big"][f][0]).length <= C.MAX_VALUE));
  const b = W.build(C.view(doc));
  assert.equal(b.data.ns.find((x) => x.id === "big").t, long);
  assert.equal(W.push(W.fromDoc(C.view(doc)), b.data, null, b.raw).diff, null);
  // it shrinks: the extra chunks are cleared
  const next = JSON.parse(JSON.stringify(b.data)); next.ns.find((x) => x.id === "big").t = "short";
  const doc2 = edit(doc, next, 11, "m1");
  const it2 = C.view(doc2).items.find((x) => x.id === "n:big");
  assert.deepEqual(it2.v, { t: "short" });
  assert.equal(it2.z0, null);
  assert.equal(W.build(C.view(doc2)).data.ns.find((x) => x.id === "big").t, "short");
});

test("two people edit one long record at once: one whole version wins", () => {
  const d = data(); d.ns.push({ id: "big", m: 3, t: "a".repeat(20000) });
  const doc = share(d, 10, "m1");
  const base = W.build(C.view(doc)).data;
  const mine = JSON.parse(JSON.stringify(base)); mine.ns.find((x) => x.id === "big").t = "b".repeat(9000);
  const theirs = JSON.parse(JSON.stringify(base)); theirs.ns.find((x) => x.id === "big").t = "c".repeat(30000);
  const A = edit(doc, mine, 20, "m1"), B = edit(doc, theirs, 21, "m2");
  const M = C.merge(A, B);
  assert.deepEqual(M, C.merge(B, A));
  assert.equal(W.build(C.view(M)).data.ns.find((x) => x.id === "big").t, "c".repeat(30000));
  // same stamp: the member id decides for every field alike
  const B2 = edit(doc, theirs, 20, "m2");
  assert.equal(W.build(C.view(C.merge(A, B2))).data.ns.find((x) => x.id === "big").t, "c".repeat(30000));
});

test("chunks that do not add up are kept, never deleted", () => {
  const d = data(); d.ns.push({ id: "big", m: 3, t: "a".repeat(20000) });
  let doc = share(d, 10, "m1");
  // a broken chunk (as if from an old copy)
  doc = C.apply(doc, { set: { "n:big": { z1: { h: "zz", s: "x" } } } }, 11, "m3");
  const b = W.build(C.view(doc));
  assert.deepEqual(b.raw, ["n:big"]);
  assert.equal(b.data.ns.find((x) => x.id === "big"), undefined);
  const next = JSON.parse(JSON.stringify(b.data)); next.set = { m: 12, c: "red" };
  const r = W.push(W.fromDoc(C.view(doc)), next, null, b.raw);
  assert.deepEqual(r.diff.del, []);
  assert.deepEqual(Object.keys(r.diff.set), ["set"]);
});

test("an own copy is stamped now", () => {
  const doc = share(data(), 10, "m1");
  const c = W.copyOf(C.view(doc), 5000);
  assert.ok(c.ns.every((x) => x.m === 5000));
  assert.equal(c.set.m, 5000);
});
