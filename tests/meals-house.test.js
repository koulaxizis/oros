// The meal plan shared with a household (meals/house.js, BR-HH wave
// 7): a built plan projects back to its document (no endless uploads),
// a deleted ready recipe stays deleted for everyone, old days do not
// travel, two people planning at once both keep their meals, and the
// shell's mirror (Today) is written only on a change.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "meals", "core.js"), "utf8"));
const MC = globalThis.OrosMealsCore;
const H = require("../meals/house.js");
const C = require("../household/core.js");

const TODAY = MC.localYmd(new Date());
const ago = (n) => MC.addDays(TODAY, -n);
const j = (x) => JSON.parse(JSON.stringify(x));
function data() {
  const d = j(MC.emptyData());
  d.rc = [{ id: "fasolada", m: 5, t: "Fasolada", sv: 4, ig: [{ q: 500, u: "g", n: "beans" }], st: ["Soak", "Boil"] }];
  d.pl[TODAY + "|d"] = { m: 6, it: [{ r: "fasolada", sv: 4 }] };
  d.pl[ago(200) + "|l"] = { m: 6, it: [{ t: "Old soup" }] };
  d.ck[TODAY + "|φασόλια"] = { m: 7, v: 1 };
  d.mn = [{ id: "n" + MC.compactYmd(MC.weekStartOf(TODAY, 1)) + "-abcd", m: 7, w: MC.weekStartOf(TODAY, 1), t: "Bread", d: 0 }];
  d.set = { m: 3, dt: [], sl: ["b", "l", "d"], nm: { d: "Βραδινό" }, ws: 1 };
  d.tombs[MC.SEED_IDS[0]] = 9;
  return MC.mergeMeals(d, d);
}
function share(d, t, by) { return C.apply(C.empty("meals"), { set: H.project(d, TODAY).items, m: { t: "Home" } }, t, by); }
function edit(doc, after, t, by) {
  const b = H.build(C.view(doc));
  const r = H.W.push(H.W.fromDoc(C.view(doc)), H.window(after, TODAY), H.extra(after), b.raw);
  return r.diff ? C.apply(doc, { set: r.diff.set, del: r.diff.del }, t, by) : doc;
}
function memLS() {
  const m = {};
  return { m, getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
}

test("a built plan projects back to its document: nothing to send", () => {
  const doc = share(data(), 10, "m1");
  const b = H.build(C.view(doc));
  assert.equal(b.data.rc[0].t, "Fasolada");
  assert.deepEqual(b.data.pl[TODAY + "|d"].it, [{ r: "fasolada", sv: 4 }]);
  assert.equal(b.data.ck[TODAY + "|φασόλια"].v, 1);
  assert.equal(b.data.set.nm.d, "Βραδινό");
  assert.equal(b.data.mn[0].t, "Bread");
  assert.ok(b.data.tombs[MC.SEED_IDS[0]] >= 9, "a deleted ready recipe stays deleted");
  assert.equal(edit(doc, b.data, 11, "m1"), doc);
  assert.deepEqual(MC.planByDay(b.data, "en")[TODAY][0].what, ["Fasolada"]);
});

test("old days do not travel", () => {
  const doc = share(data(), 10, "m1");
  const b = H.build(C.view(doc));
  assert.equal(b.data.pl[ago(200) + "|l"], undefined);
  assert.ok(Object.keys(H.project(data(), TODAY).items).every((id) => /^[A-Za-z0-9_:-]{1,72}$/.test(id)));
});

test("two people plan at once: both meals stay, ticks merge", () => {
  const doc = share(data(), 10, "m1");
  const base = H.build(C.view(doc)).data;
  const a = j(base); a.pl[TODAY + "|l"] = { m: 20, it: [{ t: "Salad" }] };
  const b = j(base); b.pl[MC.addDays(TODAY, 1) + "|d"] = { m: 21, it: [{ r: "fasolada", sv: 2 }] }; b.ck[TODAY + "|φασόλια"] = { m: 21, v: 0 };
  const A = edit(doc, a, 20, "m1"), B = edit(doc, b, 21, "m2");
  const M = C.merge(A, B);
  assert.deepEqual(M, C.merge(B, A));
  const out = H.build(C.view(M));
  assert.equal(out.data.pl[TODAY + "|l"].it[0].t, "Salad");
  assert.equal(out.data.pl[MC.addDays(TODAY, 1) + "|d"].it[0].sv, 2);
  assert.equal(out.data.ck[TODAY + "|φασόλια"].v, 0);
  assert.equal(out.by[TODAY + "|l"], "m1");
  assert.equal(edit(M, out.data, 30, "m1"), M);
});

test("an own copy keeps everything, stamped now", () => {
  const doc = share(data(), 10, "m1");
  const c = H.copyOf(C.view(doc), 99999);
  assert.equal(c.rc[0].m, 99999);
  assert.ok(c.tombs[MC.SEED_IDS[0]] >= 9);
});

test("the mirror is written only on a change", () => {
  const doc = share(data(), 10, "m1");
  const Hh = { docs: () => [{ box: "b", id: "d1", ready: true, hh: "Home" }], view: () => C.view(doc) };
  const ls = memLS();
  assert.equal(H.mirror(Hh, ls), true);
  assert.equal(H.mirror(Hh, ls), false);
  const plans = H.readMirror(JSON.parse(ls.m[H.MIRROR_KEY]));
  assert.equal(plans[0].hh, "Home");
  assert.deepEqual(MC.planByDay(plans[0].data, "en")[TODAY][0].what, ["Fasolada"]);
});
