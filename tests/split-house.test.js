// Split groups shared with a household (split/house.js, BR-HH): a group
// built from a household document projects back to exactly that
// document (no endless uploads), "who am I" is one item per member,
// two people's edits meet record by record through household/core.js,
// and a copy someone already had joins only with what is newer.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../split/house.js");
const C = require("../household/core.js");

const G = "g1abc";
function data(more) {
  return Object.assign({
    groups: [{ id: G, m: 5, n: "Flat", col: 2, cur: "EUR", arch: 0 }],
    people: [{ id: G + ".pa", m: 5, n: "Anna" }, { id: G + ".pb", m: 5, n: "Babis" }],
    exp: [{ id: G + ".e1", m: 6, t: "Groceries", a: 3000, d: "2026-10-20", c: "groc", by: { [G + ".pa"]: 3000 }, mode: "eq",
            w: { [G + ".pa"]: 1, [G + ".pb"]: 1 }, n: "" },
          { id: G + ".e2", m: 7, t: "Pizza", a: 2400, d: "2026-10-21", c: "food", by: { [G + ".pb"]: 2400 }, mode: "ex",
            w: { [G + ".pa"]: 1400, [G + ".pb"]: 1000 }, n: "", it: { l: [{ n: "Big", a: 1400, p: [G + ".pa"] }, { n: "Small", a: 1000, p: [G + ".pb"] }], x: 0, tp: 0 } }],
    pay: [{ id: G + ".y1", m: 8, f: G + ".pb", to: G + ".pa", a: 300, d: "2026-10-22" }],
    rec: [],
    mine: [{ id: G, m: 5, v: G + ".pa" }],
    tombs: {}
  }, more || {});
}
// What split.js does: share = apply the projection; edit = apply the diff.
function share(d, me, t, by) {
  const p = H.project(G, d, me);
  return C.apply(C.empty("split"), { set: p.items, m: { t: p.m.t, g: p.m.g, col: p.m.col, cur: p.m.cur, arch: p.m.arch } }, t, by);
}
function edit(doc, before, after, me, t, by) {
  const d = C.diffItems(H.project(G, before, me).items, H.project(G, after, me).items, H.FIELDS);
  return d ? C.apply(doc, { set: d.set, del: d.del }, t, by) : doc;
}
function asData(b) { return { groups: [b.group], people: b.people, exp: b.exp, pay: b.pay, rec: b.rec }; }

test("a built group projects back to its document: nothing to send", () => {
  const doc = share(data(), { m1: G + ".pa" }, 10, "m1");
  const b = H.build(C.view(doc));
  assert.equal(b.gid, G);
  assert.equal(b.group.n, "Flat");
  assert.equal(b.group.col, 2);
  assert.equal(b.people.length, 2);
  assert.equal(b.exp.length, 2);
  assert.equal(b.pay.length, 1);
  assert.deepEqual(b.me, { m1: G + ".pa" });
  assert.equal(b.by[G + ".e1"], "m1");
  const e2 = b.exp.find((x) => x.id === G + ".e2");
  assert.equal(e2.it.l.length, 2);
  assert.equal(e2.m, 10);
  const again = H.project(G, asData(b), b.me);
  assert.equal(C.diffItems(H.project(G, data(), { m1: G + ".pa" }).items, again.items, H.FIELDS), null);
  // the record's own stamp never travels (the household stamps it)
  Object.keys(doc.it).forEach((k) => { const v = doc.it[k].v[0]; assert.ok(!v || typeof v !== "object" || !("m" in v) && !("id" in v), k); });
});

test("who am I: each member's own item, and the others' items are kept", () => {
  const doc = share(data(), { m1: G + ".pa" }, 10, "m1");
  const b = H.build(C.view(doc));
  const me2 = Object.assign({}, b.me, { m2: G + ".pb" });
  const d = C.diffItems(H.project(G, asData(b), b.me).items, H.project(G, asData(b), me2).items, H.FIELDS);
  assert.deepEqual(Object.keys(d.set), ["me:m2"]);
  assert.deepEqual(d.del, []);
  const doc2 = C.apply(doc, { set: d.set, del: d.del }, 20, "m2");
  assert.deepEqual(H.build(C.view(doc2)).me, { m1: G + ".pa", m2: G + ".pb" });
});

test("two people edit at once: both edits stay, record by record", () => {
  const base = share(data(), {}, 10, "m1");
  const bA = asData(H.build(C.view(base))), bB = asData(H.build(C.view(base)));
  const a2 = JSON.parse(JSON.stringify(bA)); a2.exp[0].t = "Groceries (market)";
  const b2 = JSON.parse(JSON.stringify(bB));
  b2.exp.push({ id: G + ".e3", m: 30, t: "Bins", a: 500, d: "2026-10-23", c: "bills", by: { [G + ".pb"]: 500 }, mode: "eq", w: { [G + ".pa"]: 1, [G + ".pb"]: 1 }, n: "" });
  b2.pay = [];
  const docA = edit(base, bA, a2, {}, 20, "m1"), docB = edit(base, bB, b2, {}, 21, "m2");
  const m1 = C.merge(docA, docB), m2 = C.merge(docB, docA);
  assert.deepEqual(m1, m2);
  const got = H.build(C.view(m1));
  assert.equal(got.exp.find((x) => x.id === G + ".e1").t, "Groceries (market)");
  assert.ok(got.exp.find((x) => x.id === G + ".e3"));
  assert.equal(got.pay.length, 0);
  assert.equal(got.by[G + ".e1"], "m1");
  assert.equal(got.by[G + ".e3"], "m2");
});

test("one expense is one record: two edits never mix into an expense that does not add up", () => {
  const base = share(data(), {}, 10, "m1");
  const b = asData(H.build(C.view(base)));
  const a2 = JSON.parse(JSON.stringify(b)); a2.exp[0].a = 4000; a2.exp[0].by = { [G + ".pa"]: 4000 };
  const b2 = JSON.parse(JSON.stringify(b)); b2.exp[0].by = { [G + ".pb"]: 3000 };
  const m = C.merge(edit(base, b, a2, {}, 20, "m1"), edit(base, b, b2, {}, 21, "m2"));
  const e = H.build(C.view(m)).exp.find((x) => x.id === G + ".e1");
  const paid = Object.keys(e.by).reduce((s, k) => s + e.by[k], 0);
  assert.equal(paid, e.a);
});

test("a copy someone already had joins only with what the household lacks or is newer", () => {
  let doc = share(data(), {}, 100, "m1");
  const b = asData(H.build(C.view(doc)));
  const gone = JSON.parse(JSON.stringify(b)); gone.pay = [];
  doc = edit(doc, b, gone, {}, 200, "m1");                      // the payment was deleted at 200
  const mine = data({
    exp: data().exp.concat([{ id: G + ".e9", m: 50, t: "Old one", a: 100, d: "2026-10-01", c: "other", by: { [G + ".pa"]: 100 }, mode: "eq", w: { [G + ".pa"]: 1 }, n: "" }])
  });
  mine.exp[0] = Object.assign({}, mine.exp[0], { m: 300, t: "Edited later" });   // newer than the household's
  const add = H.adopt(doc, G, mine);
  assert.deepEqual(add.exp.map((x) => x.id).sort(), [G + ".e1", G + ".e9"]);
  assert.equal(add.pay.length, 0);                              // deleted after this copy: stays deleted
  assert.equal(add.people.length, 0);                           // the household's are newer
  const late = data({ pay: [Object.assign({}, data().pay[0], { m: 250 })] });
  assert.equal(H.adopt(doc, G, late).pay.length, 1);            // edited after the delete: comes back
});

test("the own copy keeps the ids, stamps them now, and needs a valid group id", () => {
  const doc = share(data(), { m1: G + ".pa" }, 10, "m1");
  const c = H.copyOf(C.view(doc), 999);
  assert.equal(c.gid, G);
  assert.equal(c.group.m, 999);
  c.people.concat(c.exp, c.pay).forEach((x) => assert.equal(x.m, 999));
  assert.deepEqual(c.by, {});
  const bad = C.apply(C.empty("split"), { m: { t: "x", g: "Bad.Id" } }, 10, "m1");
  assert.equal(H.build(C.view(bad)), null);
  assert.equal(H.copyOf(C.view(bad), 1), null);
});

test("records of other groups and odd items are left out", () => {
  const d = data({ people: data().people.concat([{ id: "other.p1", m: 1, n: "X" }]) });
  const p = H.project(G, d, { "bad mid": G + ".pa" });
  assert.ok(!Object.keys(p.items).some((k) => k.indexOf("other") >= 0 || k.indexOf("bad") >= 0));
  const doc = C.apply(C.empty("split"), { set: { "z:q": { v: { n: "?" } }, "p:ok": { v: "not an object" }, "e:x": { v: { t: "fine" } } }, m: { g: G, t: "Flat" } }, 10, "m1");
  const b = H.build(C.view(doc));
  assert.equal(b.people.length, 0);
  assert.equal(b.exp.length, 1);                                // split.js's normaliser judges the rest
});
