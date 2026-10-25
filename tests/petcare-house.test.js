// The Pet Health Book shared with a household (petcare/house.js, BR-HH
// wave 7c): a built book projects back to its document (no endless
// uploads), a second edit of one pet keeps the first, deleted records leave the document, photos travel while
// they fit, and the readers (shell, Today, Calendar) see a shared pet
// once, from the household.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../petcare/core.js");
const H = require("../petcare/house.js");
const C = require("../household/core.js");

const j = (x) => JSON.parse(JSON.stringify(x));
const PH = "data:image/jpeg;base64," + "A".repeat(20000);
function data() {
  return P.merge({
    ver: 1,
    pets: [{ id: "pet001", m: 5, name: "Ρεξ", sp: "dog", birth: "2020-03-01", ph: PH, vet: { n: "Dr Γ", c: "", ph: "" },
             food: { n: "Croc", g: 300, ml: 2, bag: 12000, open: "2026-10-01" } },
           { id: "pet002", m: 5, name: "Μίλα", sp: "cat", ph: PH }],
    recs: [{ id: "rec001", p: "pet001", k: "vacc", d: "2025-11-01", n: "Rabies", nx: "2026-11-01", m: 6 },
           { id: "rec002", p: "pet001", k: "weight", d: "2026-10-01", g: 21000, m: 6 },
           { id: "rec003", p: "pet002", k: "visit", d: "2026-09-01", n: "Check", m: 6 }],
    tombs: {}
  }, null);
}
function share(d, t, by) { return C.apply(C.empty("petcare"), { set: H.project(d).items, m: { t: "Home" } }, t, by); }
function edit(doc, after, t, by) {
  const r = H.W.push(H.W.fromDoc(C.view(doc)), H.window(after), null, H.build(C.view(doc)).raw);
  return r.diff ? C.apply(doc, { set: r.diff.set, del: r.diff.del }, t, by) : doc;
}

test("a built book projects back to its document: nothing to send", () => {
  const doc = share(data(), 10, "m1");
  const b = H.build(C.view(doc));
  assert.equal(b.data.pets.length, 2);
  assert.equal(b.data.pets[0].name, "Ρεξ");
  assert.equal(b.data.pets[0].ph, PH, "a photo travels in chunks");
  assert.equal(b.data.recs.length, 3);
  assert.equal(edit(doc, b.data, 11, "m1"), doc);
  assert.equal(b.by.pet001, "m1");
});

test("one pet, two people, different parts: the second edit keeps the first", () => {
  const doc = share(data(), 10, "m1");
  const base = H.build(C.view(doc)).data;
  const a = j(base), b = j(base);
  const pa = a.pets[0], pb = b.pets[0];
  const beforeA = j(pa), beforeB = j(pb);
  pa.food.g = 350; P.touch(pa, beforeA, 20);
  pb.vet.n = "Dr Νέος"; P.touch(pb, beforeB, 21);
  // B's copy is rebuilt when A's edit arrives (hhRefresh); B's edit then
  // goes on top of it. (Edits sent at the very same moment: the newer
  // item wins the pet, as for any record.)
  const da = edit(doc, a, 20, "m1");
  const db = edit(da, P.merge(b, H.build(C.view(da)).data), 21, "m2");
  const end = H.build(C.view(db)).data.pets[0];
  assert.equal(end.vet.n, "Dr Νέος");
  assert.equal(end.food.g, 350);
});

test("a deleted record leaves the document", () => {
  const doc = share(data(), 10, "m1");
  const d = H.build(C.view(doc)).data;
  d.recs = d.recs.filter((r) => r.id !== "rec002");
  d.tombs.rec002 = 30;
  const doc2 = edit(doc, d, 30, "m2");
  assert.equal(H.build(C.view(doc2)).data.recs.some((r) => r.id === "rec002"), false);
});

test("photos travel while they fit the budget; the own book keeps all", () => {
  const d = j(data());
  for (let i = 3; i < 12; i++) d.pets.push({ id: "pet0" + (i < 10 ? "0" : "") + i, m: 5, name: "P" + i, sp: "fish", ph: PH });
  const own = P.merge(d, null);
  const w = H.window(own);
  const withPh = w.pets.filter((p) => p.ph).length;
  assert.equal(withPh, Math.floor(H.PHOTO_BUDGET / PH.length));
  assert.equal(own.pets.filter((p) => p.ph).length, 11, "nothing is taken from the own book");
});

test("union: a shared pet is read from the household, once", () => {
  const own = data();
  const doc = share(own, 10, "m1");
  const set = H.build(C.view(doc)).data;
  set.recs.push({ id: "rec009", p: "pet001", k: "vacc", d: "2026-10-20", n: "Rabies", nx: "2027-10-20", m: 40 });
  const solo = j(own);
  solo.pets.push({ id: "pet777", m: 5, name: "Only mine", sp: "bird" });
  const u = H.union(P.merge(solo, null), [{ id: "d1", t: "Home", hh: "Home", data: P.merge(set, null) }]);
  assert.deepEqual(u.pets.map((p) => p.id), ["pet001", "pet002", "pet777"]);
  const items = P.items(u, "2026-10-24").filter((it) => it.pet.id === "pet001" && it.kind === "vacc");
  assert.equal(items.length, 1);
  assert.equal(items[0].due, "2027-10-20", "the household's newer dose counts");
});

test("mirror is written only on a change", () => {
  const doc = share(data(), 10, "m1");
  const m = {};
  const ls = { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
  const Hh = { docs: () => [{ box: "b1", id: "d1", hh: "Home", ready: true }], view: () => C.view(doc) };
  assert.equal(H.mirror(Hh, ls), true);
  assert.equal(H.mirror(Hh, ls), false);
  const sets = H.readMirror(JSON.parse(m[H.MIRROR_KEY]));
  assert.equal(sets[0].data.pets.length, 2);
  assert.equal(H.withShared(P.merge({ pets: [], recs: [], tombs: {} }, null), ls).pets.length, 2);
});
