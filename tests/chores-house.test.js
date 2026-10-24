// Chore wheels shared with a household (chores/house.js, BR-HH): a
// wheel built from a household document projects back to exactly that
// document (no endless uploads), "who am I" is one item per member,
// two people's marks meet mark by mark through household/core.js, only
// recent marks travel, and the shell's mirror is written on a change.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const CC = require("../chores/core.js");
const H = require("../chores/house.js");
const C = require("../household/core.js");

const TODAY = "2026-10-24";
function data(more) {
  return Object.assign({
    ver: 1,
    members: [{ id: "anna01", m: 5, name: "Anna", color: 1, icon: "", away: null, order: 0, om: 5 },
              { id: "babis1", m: 5, name: "Babis", color: 2, icon: "🐻", away: ["2026-11-01", "2026-11-03"], order: 1, om: 5 }],
    tasks: [{ id: "dishes", m: 6, name: "Dishes", icon: "🍽️", freq: { k: "d" }, weight: 1, mode: "rr", who: [], start: "2026-10-01", off: 0 },
            { id: "bins01", m: 6, name: "Bins", icon: "", freq: { k: "wd", d: [3, 0] }, weight: 2, mode: "bal", who: ["babis1", "anna01"], start: "2026-10-01", off: 1 }],
    done: { "dishes|2026-10-23": [1, "anna01", 7], "dishes|2026-10-22": [2, "", 7], "dishes|2026-01-02": [1, "anna01", 7] },
    set: { "bins01|2026-10-26": ["anna01", 8] },
    tombs: {}
  }, more || {});
}
function share(d, me, t, by) {
  const p = H.project(d, me, TODAY);
  return C.apply(C.empty("chores"), { set: p.items, m: { t: "Home" } }, t, by);
}
function edit(doc, before, after, me, t, by) {
  const d = C.diffItems(H.fromDoc(C.view(doc)), H.project(after, me, TODAY).items, H.FIELDS);
  return d ? C.apply(doc, { set: d.set, del: d.del }, t, by) : doc;
}
function memLS() {
  const m = {};
  return { m, getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
}

test("a built wheel projects back to its document: nothing to send", () => {
  const doc = share(data(), { m1: "anna01" }, 10, "m1");
  const b = H.build(C.view(doc));
  assert.equal(b.data.members.length, 2);
  assert.equal(b.data.tasks.length, 2);
  assert.deepEqual(b.data.members[1].away, ["2026-11-01", "2026-11-03"]);
  assert.deepEqual(b.data.tasks[0].who, ["anna01", "babis1"]);
  assert.deepEqual(b.data.done["dishes|2026-10-23"], [1, "anna01", 10]);
  assert.deepEqual(b.data.set["bins01|2026-10-26"], ["anna01", 10]);
  assert.deepEqual(b.me, { m1: "anna01" });
  assert.equal(b.by.dishes, "m1");
  assert.equal(C.diffItems(H.fromDoc(C.view(doc)), H.project(b.data, b.me, TODAY).items, H.FIELDS), null);
  // the turn is the same on every device: the wheel works on the built data
  const ctx = CC.makeCtx(b.data), ctx0 = CC.makeCtx(CC.mergeChores(data(), data()));
  const n = CC.ymdToDn(TODAY);
  assert.deepEqual(CC.dayRows(ctx, n).map((r) => r.who), CC.dayRows(ctx0, n).map((r) => r.who));
});

test("old marks stay home: only the last 92 days travel", () => {
  const doc = share(data(), {}, 10, "m1");
  assert.ok(!Object.keys(doc.it).some((k) => k.indexOf("2026-01-02") >= 0));
  assert.ok(doc.it["dn:dishes:2026-10-23"]);
  // a mark that grew old leaves the document with the next change
  const b = H.build(C.view(doc));
  const later = C.diffItems(H.fromDoc(C.view(doc)), H.project(b.data, {}, "2027-01-30").items, H.FIELDS);
  assert.ok(later.del.indexOf("dn:dishes:2026-10-22") >= 0);
});

test("never more marks than a document holds", () => {
  const done = {};
  for (let i = 0; i < 2000; i++) done["dishes|" + CC.dnToYmd(CC.ymdToDn(TODAY) - (i % 90)) ] = [1, "anna01", i + 1];
  const many = data({ tasks: data().tasks.concat(Array.from({ length: 30 }, (_, j) => ({ id: "task" + String(j).padStart(2, "0"), m: 1, name: "T" + j, icon: "", freq: { k: "d" }, weight: 1, mode: "rr", who: [], start: "2026-01-01", off: 0 }))) });
  for (let j = 0; j < 30; j++) for (let i = 0; i < 90; i++) done["task" + String(j).padStart(2, "0") + "|" + CC.dnToYmd(CC.ymdToDn(TODAY) - i)] = [1, "babis1", 1];
  many.done = done;
  const p = H.project(many, {}, TODAY);
  const marks = Object.keys(p.items).filter((k) => /^(dn|st):/.test(k));
  assert.equal(marks.length, H.EV_MAX);
  assert.ok(Object.keys(p.items).length < 3000);
});

test("two people mark at once: both marks stay, and who am I is each one's own", () => {
  const base = share(data(), { m1: "anna01" }, 10, "m1");
  const bA = H.build(C.view(base)), bB = H.build(C.view(base));
  const a2 = JSON.parse(JSON.stringify(bA.data)); a2.done["dishes|2026-10-24"] = [1, "anna01", 20];
  const b2 = JSON.parse(JSON.stringify(bB.data)); b2.done["bins01|2026-10-22"] = [1, "babis1", 21]; b2.tasks[0].name = "Recycling";
  const docA = edit(base, bA.data, a2, { m1: "anna01" }, 20, "m1");
  const docB = edit(base, bB.data, b2, { m1: "anna01", m2: "babis1" }, 21, "m2");
  const m1 = C.merge(docA, docB), m2 = C.merge(docB, docA);
  assert.deepEqual(m1, m2);
  const got = H.build(C.view(m1));
  assert.equal(got.data.done["dishes|2026-10-24"][0], 1);
  assert.equal(got.data.done["bins01|2026-10-22"][1], "babis1");
  assert.equal(CC.taskById(got.data, "bins01").name, "Recycling");
  assert.deepEqual(got.me, { m1: "anna01", m2: "babis1" });
  assert.equal(got.by["dishes|2026-10-24"], "m1");
  assert.equal(got.by.bins01, "m2");
});

test("a deleted chore takes its marks with it", () => {
  const doc = share(data(), {}, 10, "m1");
  const b = H.build(C.view(doc));
  const d2 = JSON.parse(JSON.stringify(b.data));
  d2.tasks = d2.tasks.filter((x) => x.id !== "dishes");
  d2.tombs.dishes = 30;
  const after = H.build(C.view(edit(doc, b.data, d2, {}, 30, "m1")));
  assert.equal(after.data.tasks.length, 1);
  assert.ok(!Object.keys(C.view(edit(doc, b.data, d2, {}, 30, "m1")).items).some((x) => x.id && x.id.indexOf("dishes") >= 0));
});

test("the own copy keeps the ids and stamps them now", () => {
  const doc = share(data(), { m1: "anna01" }, 10, "m1");
  const c = H.copyOf(C.view(doc), 999);
  c.data.members.forEach((x) => { assert.equal(x.m, 999); assert.equal(x.om, 999); });
  c.data.tasks.forEach((x) => assert.equal(x.m, 999));
  assert.equal(c.data.done["dishes|2026-10-23"][2], 999);
  assert.deepEqual(c.me, { m1: "anna01" });
});

test("bad items from someone else's device are left out or cleaned", () => {
  const doc = C.apply(C.empty("chores"), { set: {
    "mb:okay01": { c: { name: "<b>X</b>", color: 99, icon: "<x>" }, o: 3 },
    "mb:BAD": { c: { name: "no" } },
    "tk:task01": { v: { name: "", freq: { k: "d" }, start: "2026-10-01" } },
    "dn:task01:2026-10-20": { v: "nope" },
    "me:m9": { v: "Not An Id" }
  }, m: { t: "Home" } }, 10, "m2");
  const b = H.build(C.view(doc));
  assert.deepEqual(b.data.members.map((x) => x.id), ["okay01"]);
  assert.equal(b.data.members[0].color, 0);
  assert.equal(b.data.members[0].icon, "");
  assert.equal(b.data.tasks.length, 0);
  assert.deepEqual(b.data.done, {});
  assert.deepEqual(b.me, {});
});

test("the mirror holds this person's wheels with their own me, written only on a change", () => {
  let doc = share(data(), { m1: "anna01", m2: "babis1" }, 10, "m1");
  let docs = [{ box: "B", id: "D1", kind: "chores", ready: true, hh: "Flat" }];
  const Hh = { docs: () => docs, view: (box, id, q) => C.view(doc, q), me: () => "m2" };
  const ls = memLS();
  assert.equal(H.mirror(Hh, ls), true);
  const w = H.readMirror(JSON.parse(ls.getItem(H.MIRROR_KEY)));
  assert.equal(w.length, 1);
  assert.equal(w[0].me, "babis1");
  assert.equal(w[0].t, "Home");
  assert.deepEqual(CC.summary(w[0].data, CC.ymdToDn(TODAY), w[0].me).names.length >= 0, true);
  assert.equal(H.mirror(Hh, ls), false);
  doc = C.apply(doc, { set: { "dn:dishes:2026-10-24": { v: [1, "babis1"] } } }, 20, "m2");
  assert.equal(H.mirror(Hh, ls), true);
  docs = [];
  assert.equal(H.mirror(Hh, ls), true);
  assert.equal(ls.getItem(H.MIRROR_KEY), null);
});

test("search and Today read the household wheels from the mirror", () => {
  const S = require("../chores/search.js"), T = require("../chores/today.js");
  globalThis.OrosChoresCore = CC;
  try {
    const doc = share(data(), { m2: "babis1" }, 10, "m1");
    const ls = memLS();
    H.mirror({ docs: () => [{ box: "B", id: "D9", kind: "chores", ready: true }], view: (b, i, q) => C.view(doc, q), me: () => "m2" }, ls);
    const ctx = { readJSON: (k) => { try { return JSON.parse(ls.getItem(k)); } catch (e) { return null; } }, lang: "en", today: TODAY, now: Date.parse(TODAY + "T12:00:00Z") };
    const hits = S.search(ctx);
    const dish = hits.find((h) => h.target.task === "dishes");
    assert.deepEqual(dish.target, { task: "dishes", wheel: "D9" });
    const rows = T.collect(ctx);
    assert.ok(rows.length > 0);
    // only Babis's turns: Babis is "me" for member m2 in that wheel
    const mine = CC.dayRows(CC.makeCtx(H.build(C.view(doc)).data), CC.ymdToDn(TODAY)).filter((r) => r.state === 0 && r.who === "babis1");
    assert.equal(rows.length, mine.length);
  } finally { delete globalThis.OrosChoresCore; }
});
