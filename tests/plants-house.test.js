// Plants shared with a household (plants/house.js, BR-HH): a garden
// built from a household document projects back to exactly that
// document (no endless uploads), "I watered it" on one phone moves the
// next due day for everyone, each plant's reminder can be for one
// member, only recent entries (and every schedule's base) travel, and
// the shell's mirror is written only on a change.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const PC = require("../plants/core.js");
const H = require("../plants/house.js");
const C = require("../household/core.js");

const TODAY = PC.ymdOf(new Date());
const ago = (n) => PC.addDays(TODAY, -n);
function data(more) {
  return Object.assign({
    ver: 1,
    plants: [{ id: "basil01", m: 5, name: "Basil", sp: "basil", room: "Balcony", out: 1, em: "🌿", w: 2, ww: 3, f: 14, mi: 0, r: 0, st: ago(30), sn: {}, notes: "" },
             { id: "fern001", m: 5, name: "Fern", sp: "fern", room: "Bath", sci: "Nephrolepis", out: 0, em: "", w: 3, ww: 5, f: 0, mi: 2, r: 360, st: ago(400), sn: { mist: ago(-2) }, notes: "by the window" }],
    log: [{ id: "log0001", p: "basil01", k: "water", d: ago(2), s: 0, m: 6 },
          { id: "log0002", p: "fern001", k: "repot", d: ago(300), s: 0, m: 6 },
          { id: "log0003", p: "fern001", k: "water", d: ago(250), s: 0, m: 6 },
          { id: "log0004", p: "fern001", k: "water", d: ago(1), s: 1, m: 6 }],
    tombs: {}
  }, more || {});
}
function share(d, who, t, by) {
  const p = H.project(d, who, TODAY);
  return C.apply(C.empty("plants"), { set: p.items, m: { t: "Home" } }, t, by);
}
function edit(doc, after, who, t, by) {
  const d = C.diffItems(H.fromDoc(C.view(doc)), H.project(after, who, TODAY).items, H.FIELDS);
  return d ? C.apply(doc, { set: d.set, del: d.del }, t, by) : doc;
}
function memLS() {
  const m = {};
  return { m, getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
}

test("a built garden projects back to its document: nothing to send", () => {
  const doc = share(data(), { fern001: "m2" }, 10, "m1");
  const b = H.build(C.view(doc));
  assert.equal(b.data.plants.length, 2);
  const fern = b.data.plants.find((p) => p.id === "fern001");
  assert.equal(fern.sci, "Nephrolepis");
  assert.deepEqual(fern.sn, { mist: ago(-2) });
  assert.equal(fern.m, 10);
  assert.deepEqual(b.who, { fern001: "m2" });
  assert.equal(b.by.basil01, "m1");
  assert.equal(C.diffItems(H.fromDoc(C.view(doc)), H.project(b.data, b.who, TODAY).items, H.FIELDS), null);
  // the schedule is the same on every device
  assert.deepEqual(PC.tasks(b.data, TODAY, 7, "n").map((x) => x.key + x.due), PC.tasks(PC.merge(data(), data()), TODAY, 7, "n").map((x) => x.key + x.due));
});

test("old entries stay home, but every schedule keeps its base", () => {
  const doc = share(data(), {}, 10, "m1");
  assert.ok(doc.it["l:log0002"], "the only repot: the base of the repot schedule");
  assert.ok(!doc.it["l:log0003"], "an old watering, not the newest");
  assert.ok(doc.it["l:log0004"]);
});

test("never more entries than a document holds", () => {
  const log = [];
  for (let i = 0; i < 4000; i++) log.push({ id: "e" + String(i).padStart(6, "0"), p: "basil01", k: "water", d: ago(i % 170), s: 0, m: 1 });
  const p = H.project(data({ log }), {}, TODAY);
  assert.equal(Object.keys(p.items).filter((k) => k.startsWith("l:")).length, H.LOG_MAX);
});

test("I watered it: the next due day moves for everyone, and two people at once both count", () => {
  const base = share(data(), {}, 10, "m1");
  const a = H.build(C.view(base)).data, b = H.build(C.view(base)).data;
  a.log.push({ id: "wateraa", p: "basil01", k: "water", d: TODAY, s: 0, m: 20 });
  b.log.push({ id: "mistbbb", p: "fern001", k: "mist", d: TODAY, s: 0, m: 21 });
  b.plants.find((p) => p.id === "fern001").notes = "moved to the kitchen";
  const m1 = C.merge(edit(base, a, {}, 20, "m1"), edit(base, b, {}, 21, "m2"));
  assert.deepEqual(m1, C.merge(edit(base, b, {}, 21, "m2"), edit(base, a, {}, 20, "m1")));
  const got = H.build(C.view(m1));
  const due = PC.tasks(got.data, TODAY, 30, "n");
  // the interval in force today: 2 days, 3 in winter (Nov–Feb north)
  const basil = got.data.plants.find((p) => p.id === "basil01");
  assert.equal(due.find((x) => x.key === "basil01:water").due, PC.addDays(TODAY, PC.interval(basil, "water", TODAY, "n")));
  assert.equal(got.data.plants.find((p) => p.id === "fern001").notes, "moved to the kitchen");
  assert.equal(got.by.wateraa, "m1");
  assert.equal(got.by.mistbbb, "m2");
});

test("a deleted plant takes its entries and its reminder member with it", () => {
  const doc = share(data(), { basil01: "m2" }, 10, "m1");
  const d2 = H.build(C.view(doc)).data;
  d2.plants = d2.plants.filter((p) => p.id !== "basil01");
  d2.tombs.basil01 = 30;
  const after = edit(doc, d2, { basil01: "m2" }, 30, "m1");
  const v = C.view(after);
  assert.ok(!v.items.some((x) => x.id.indexOf("basil01") >= 0 || x.id === "l:log0001"));
});

test("the own copy keeps the ids and stamps them now", () => {
  const c = H.copyOf(C.view(share(data(), {}, 10, "m1")), 999);
  c.data.plants.concat(c.data.log).forEach((x) => assert.equal(x.m, 999));
  assert.equal(c.data.plants.length, 2);
});

test("bad items from someone else's device are left out or cleaned", () => {
  const doc = C.apply(C.empty("plants"), { set: {
    "p:okplant": { v: { name: "<b>Ivy</b>", w: 999, st: TODAY } },
    "p:BAD": { v: { name: "x", w: 3, st: TODAY } },
    "p:nowater": { v: { name: "x", st: TODAY } },
    "l:entry01": { v: { p: "okplant", k: "dance", d: TODAY } },
    "wh:okplant": { v: "bad mid!" }
  }, m: { t: "Home" } }, 10, "m2");
  const b = H.build(C.view(doc));
  assert.deepEqual(b.data.plants.map((p) => p.id), []);   // w out of range: dropped by normPlant
  assert.deepEqual(b.data.log, []);
  assert.deepEqual(b.who, {});
});

test("the mirror holds each garden with the plants that remind this person", () => {
  let doc = share(data(), { fern001: "m2" }, 10, "m1");
  let docs = [{ box: "B", id: "G1", kind: "plants", ready: true, hh: "Flat" }];
  const ls = memLS();
  const Hh = (me) => ({ docs: () => docs, view: (b, i, q) => C.view(doc, q), me: () => me });
  assert.equal(H.mirror(Hh("m1"), ls), true);
  let g = H.readMirror(JSON.parse(ls.getItem(H.MIRROR_KEY)));
  assert.deepEqual(g[0].own.plants.map((p) => p.id), ["basil01"]);
  assert.equal(g[0].data.plants.length, 2);
  assert.equal(H.mirror(Hh("m1"), ls), false);
  assert.equal(H.mirror(Hh("m2"), ls), true);
  g = H.readMirror(JSON.parse(ls.getItem(H.MIRROR_KEY)));
  assert.deepEqual(g[0].own.plants.map((p) => p.id).sort(), ["basil01", "fern001"]);
  docs = [];
  assert.equal(H.mirror(Hh("m2"), ls), true);
  assert.equal(ls.getItem(H.MIRROR_KEY), null);
});

test("search and Today read the household gardens; Today only what reminds this person", () => {
  const S = require("../plants/search.js"), T = require("../plants/today.js");
  globalThis.OrosPlantsCore = PC;
  try {
    const d = data();
    d.log = d.log.filter((x) => x.p !== "basil01");        // basil is due now
    const doc = share(d, { fern001: "m2" }, 10, "m1");
    const ls = memLS();
    H.mirror({ docs: () => [{ box: "B", id: "G9", kind: "plants", ready: true }], view: (b, i, q) => C.view(doc, q), me: () => "m1" }, ls);
    const ctx = { readJSON: (k) => { try { return JSON.parse(ls.getItem(k)); } catch (e) { return null; } }, lang: "en", today: TODAY, now: Date.now(), horizon: 30 };
    assert.deepEqual(S.search(ctx).map((h) => h.target).sort(), ["basil01", "fern001"]);
    const rows = T.collect(ctx);
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r.target.plant === "basil01"), "the fern reminds m2 only");
  } finally { delete globalThis.OrosPlantsCore; }
});
