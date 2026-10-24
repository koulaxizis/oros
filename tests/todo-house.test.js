// To-Do lists shared with a household (todo/house.js, BR-HH): a list
// built from a household document projects back to exactly that
// document (no endless uploads), labels stay personal, and edits from
// two people meet field by field through household/core.js.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../todo/house.js");
const C = require("../household/core.js");

function listOf(items, extra) {
  return Object.assign({ id: "tdl-x", name: "Groceries", recurrence: null, lastReset: null, nextReset: null, items }, extra || {});
}
function task(id, text, more) {
  return Object.assign({ id, text, done: false, due: null, notes: "", labels: [], info: [], recurrence: null, mtime: 1 }, more || {});
}
// What todo.js does: share = apply the projection; edit = apply the diff.
function share(list, t, by) {
  const p = H.project(list);
  return C.apply(C.empty("todo"), { set: p.items, m: { t: p.m.t, rec: p.m.rec, last: p.m.last, next: p.m.next } }, t, by);
}
function edit(doc, before, after, t, by) {
  const d = C.diffItems(H.project(before).items, H.project(after).items, H.FIELDS);
  return d ? C.apply(doc, { set: d.set, del: d.del }, t, by) : doc;
}

test("a built list projects back to its document: nothing to send", () => {
  const doc = share(listOf([task("a", "Milk", { due: "2026-10-30", prio: 2, notes: "2 l" }), task("b", "Bread", { done: true,
    subs: [{ id: "s1", text: "rye", done: false, mtime: 3 }], info: [{ label: "Shop", value: "Corner" }] })],
    { recurrence: { every: 1, unit: "week", weekday: 6 }, lastReset: "2026-10-24", nextReset: "2026-10-31" }), 10, "m1");
  const v = C.view(doc);
  const built = H.build(v, "D1", null);
  assert.equal(built.id, "tdh-D1");
  assert.equal(built.name, "Groceries");
  assert.deepEqual(built.recurrence, { every: 1, unit: "week", weekday: 6 });
  assert.equal(C.diffItems(H.project(built).items, H.project(H.build(C.view(doc), "D1", built)).items, H.FIELDS), null);
  const fromDoc = {};
  v.items.forEach((it) => { fromDoc[it.id] = {}; H.FIELDS.forEach((f) => { fromDoc[it.id][f] = it[f] === undefined ? null : it[f]; }); });
  assert.equal(C.diffItems(fromDoc, H.project(built).items, H.FIELDS), null);
  assert.equal(built.items[0].hhBy, "m1");
});

test("labels stay on this screen only, and never reach the document", () => {
  const doc = share(listOf([task("a", "Milk", { labels: ["lb1"] })]), 10, "m1");
  assert.equal(JSON.stringify(doc).indexOf("lb1"), -1);
  const keep = H.build(C.view(doc), "D1", null);
  keep.items[0].labels = ["lb2"];
  const again = H.build(C.view(doc), "D1", keep);
  assert.deepEqual(again.items[0].labels, ["lb2"]);
});

test("two people edit at once: both edits stay", () => {
  const base = share(listOf([task("a", "Milk"), task("b", "Bread")]), 10, "m1");
  const listA = H.build(C.view(base), "D1", null), listB = H.build(C.view(base), "D1", null);
  const a2 = JSON.parse(JSON.stringify(listA)); a2.items[0].done = true;
  const b2 = JSON.parse(JSON.stringify(listB)); b2.items[0].notes = "oat"; b2.items.push(task("c", "Eggs"));
  const docA = edit(base, listA, a2, 20, "m1"), docB = edit(base, listB, b2, 21, "m2");
  const m = C.merge(docA, docB);
  assert.ok(C.same(m, C.merge(docB, docA)));
  const out = H.build(C.view(m), "D1", null);
  const milk = out.items.find((x) => x.id === "a");
  assert.equal(milk.done, true);
  assert.equal(milk.notes, "oat");
  assert.ok(out.items.some((x) => x.id === "c"));
});

test("a deleted task is gone; ticking it later elsewhere brings it back", () => {
  const base = share(listOf([task("a", "Milk"), task("b", "Bread")]), 10, "m1");
  const l = H.build(C.view(base), "D1", null);
  const gone = JSON.parse(JSON.stringify(l)); gone.items = gone.items.filter((x) => x.id !== "a");
  const del = edit(base, l, gone, 20, "m1");
  assert.ok(!H.build(C.view(del), "D1", null).items.some((x) => x.id === "a"));
  const tick = JSON.parse(JSON.stringify(l)); tick.items[0].done = true;
  const later = edit(base, l, tick, 30, "m2");
  assert.ok(H.build(C.view(C.merge(del, later)), "D1", null).items.some((x) => x.id === "a"));
});

test("an own copy keeps the task ids, without the household marks", () => {
  const doc = share(listOf([task("a", "Milk"), task("b", "Bread")]), 10, "m1");
  const c = H.copyOf(C.view(doc), "D1");
  assert.equal(c.id, "tdc-D1");
  assert.deepEqual(c.items.map((x) => x.id), ["a", "b"]);
  assert.ok(c.items.every((x) => x.hhBy === undefined));
  assert.ok(H.isShared("tdh-x") && !H.isShared("tdc-x") && H.docOf("tdh-abc") === "abc");
});

test("rubbish in a document builds a clean list", () => {
  const doc = C.apply(C.empty("todo"), { set: { a: { text: 5, done: "yes", due: "soon", prio: 9, subs: "x", info: [null, { label: 1 }], recurrence: { unit: "year" } } }, m: { t: "" } }, 5, "m1");
  const l = H.build(C.view(doc), "D1", null);
  assert.equal(l.name, "?");
  assert.deepEqual([l.items[0].text, l.items[0].done, l.items[0].due, l.items[0].prio, l.items[0].subs, l.items[0].recurrence], ["", false, null, undefined, undefined, null]);
  assert.deepEqual(l.items[0].info, [{ label: "", value: "" }]);
});
