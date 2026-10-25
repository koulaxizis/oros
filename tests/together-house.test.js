// A relationship shared with a household (together/house.js, BR-HH
// wave 7d): only that relationship and its moments, days and meetings
// travel (never gift ideas or settings), a built copy projects back to
// its document (no endless uploads), the app's union shows each record
// once, an edit of the union goes back where each record lives, and
// stopping brings everything back over the tombstones.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../together/core.js");
const H = require("../together/house.js");
const C = require("../household/core.js");

const j = (x) => JSON.parse(JSON.stringify(x));
function data() {
  return T.normalize({
    ver: 1,
    rels: [{ id: "relA", m: 5, people: [{ n: "Νίκος" }], title: "", start: "2020-06-01", kind: "couple", ord: 0 },
           { id: "relB", m: 5, people: [{ n: "Μαρία" }], title: "", start: "2015-01-01", kind: "friends", ord: 1 }],
    moments: [{ id: "moA1", m: 6, rel: "relA", date: "2021-08-15", title: "Νάξος", note: "Θάλασσα", yearly: true },
              { id: "moB1", m: 6, rel: "relB", date: "2016-02-02", title: "Concert" }],
    days: [{ id: "dyA1", m: 6, rel: "relA", date: "2020-09-09", title: "First dance", yearly: true }],
    meets: [], gifts: [{ id: "gfA1", m: 6, rel: "relA", text: "Ρολόι", done: false }],
    prefs: { m: 3, me: "Άννα", hour: 8 }, tombs: {}
  });
}
function shareRel(own, relId) { return C.apply(C.empty("together"), { set: H.project(H.only(own, relId)).items, m: { t: "Νίκος" } }, 10, "m1"); }
function tomb(own, ids, now) {
  const d = j(own);
  ids.forEach((id) => { d.tombs[id] = now; });
  return T.normalize(d);
}

test("only the relationship and its rows travel; gifts and settings never", () => {
  const doc = shareRel(data(), "relA");
  const b = H.build(C.view(doc)).data;
  assert.deepEqual(b.rels.map((r) => r.id), ["relA"]);
  assert.deepEqual(b.moments.map((r) => r.id), ["moA1"]);
  assert.deepEqual(b.days.map((r) => r.id), ["dyA1"]);
  assert.equal((b.gifts || []).length, 0);
  assert.ok(!Object.keys(C.view(doc).items.reduce((o, it) => (o[it.id] = 1, o), {})).some((id) => /^g|^prefs/.test(id)));
  const r = H.W.push(H.W.fromDoc(C.view(doc)), H.window(b), null, []);
  assert.equal(r.diff, null, "nothing to send after a round trip");
  assert.deepEqual(H.moved(data(), "relA"), ["dyA1", "moA1", "relA"]);
});

test("union: each record once, own settings and gifts kept", () => {
  const own0 = data();
  const doc = shareRel(own0, "relA");
  const own = tomb(own0, H.moved(own0, "relA"), 20);
  const sets = [{ key: "b/d", hh: "Σπίτι", data: H.build(C.view(doc)).data }];
  const u = H.union(own, sets);
  assert.deepEqual(u.rels.map((r) => r.id).sort(), ["relA", "relB"]);
  assert.deepEqual(u.moments.map((r) => r.id).sort(), ["moA1", "moB1"]);
  assert.equal(u.gifts.length, 1, "the gift idea stays, private");
  assert.equal(u.prefs.me, "Άννα");
  assert.ok(!("relA" in u.tombs), "own tombstones of moved records do not hide them");
});

test("split: an edit goes back where each record lives", () => {
  const own0 = data();
  const doc = shareRel(own0, "relA");
  const own = tomb(own0, H.moved(own0, "relA"), 20);
  const sets = [{ key: "b/d", hh: "Σπίτι", data: H.build(C.view(doc)).data }];
  let u = H.union(own, sets);
  u = T.put(u, "moments", { id: "moA2", rel: "relA", date: "2026-10-20", title: "Δείπνο" }, 30);
  u = T.put(u, "moments", { id: "moB2", rel: "relB", date: "2026-10-21", title: "Coffee" }, 31);
  u = T.remove(u, "days", "dyA1", 32);
  u = T.put(u, "gifts", { id: "gfA2", rel: "relA", text: "Βιβλίο", done: false }, 33);
  const sp = H.split(u, sets);
  assert.deepEqual(sp.parts[0].moments.map((r) => r.id), ["moA1", "moA2"]);
  assert.equal(sp.parts[0].days.length, 0, "a deleted shared day leaves the household copy");
  assert.deepEqual(sp.own.moments.map((r) => r.id), ["moB1", "moB2"]);
  assert.deepEqual(sp.own.gifts.map((r) => r.id), ["gfA1", "gfA2"]);
  // the household copy takes the change as records
  const r = H.W.push(H.W.fromDoc(C.view(doc)), H.window(sp.parts[0]), null, []);
  const doc2 = C.apply(doc, { set: r.diff.set, del: r.diff.del }, 34, "m2");
  const b2 = H.build(C.view(doc2)).data;
  assert.deepEqual(b2.moments.map((x) => x.id), ["moA1", "moA2"]);
  assert.equal(b2.days.length, 0);
});

test("stop sharing: the copy comes back over the tombstones", () => {
  const own0 = data();
  const doc = shareRel(own0, "relA");
  const own = tomb(own0, H.moved(own0, "relA"), 20);
  assert.deepEqual(own.rels.map((r) => r.id), ["relB"]);
  const back = T.merge(own, H.copyOf(C.view(doc), 50));
  assert.deepEqual(back.rels.map((r) => r.id), ["relA", "relB"]);
  assert.deepEqual(back.moments.map((r) => r.id), ["moA1", "moB1"]);
  assert.equal(back.moments[0].note, "Θάλασσα");
});

test("mirror and readers: written only on a change, union for the shell", () => {
  const own0 = data();
  const doc = shareRel(own0, "relA");
  const m = {};
  const ls = { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
  const Hh = { docs: () => [{ box: "b1", id: "d1", hh: "Σπίτι", ready: true }], view: () => C.view(doc) };
  assert.equal(H.mirror(Hh, ls), true);
  assert.equal(H.mirror(Hh, ls), false);
  const u = H.withShared(T.empty(), ls);
  assert.deepEqual(u.rels.map((r) => r.id), ["relA"]);
  assert.ok(T.dayRows(u, {}, "2027-08-15", "en", {}).length >= 1, "the yearly moment shows for the partner");
});
