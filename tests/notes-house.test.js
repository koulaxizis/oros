// A notebook shared with a household (notes/house.js, BR-HH wave 7f;
// household/group.js): the notebook, its pages and labels travel; a
// built notebook projects back to its document (no endless uploads)
// and carries no item stamps; the union shows each page once and an
// own page written into the shared notebook elsewhere; split routes
// an edit; stop sharing brings the notebook back over the tombstones
// ("nb:" and "lbl:" keys); long pages and big notebooks are refused.
// notes.js owns the real merge (it needs the page); a small stand-in
// with the same tombstone rules is used here, the browser run covers
// the real one.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const NHm = require("../notes/house.js");
const C = require("../household/core.js");

const j = (x) => JSON.parse(JSON.stringify(x));
const KEY = { notebooks: (id) => "nb:" + id, labels: (id) => "lbl:" + id, pages: (id) => id };
function canon(d) {
  d = j(d || {});
  const out = { ver: 3, notebooks: [], pages: [], labels: [], tombs: {} };
  const alive = {};
  ["notebooks", "pages", "labels"].forEach((k) => {
    out[k] = (d[k] || []).filter((r) => r && typeof r.id === "string")
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    out[k].forEach((r) => { alive[KEY[k](r.id)] = 1; });
  });
  Object.keys(d.tombs || {}).sort().forEach((k) => { if (!alive[k]) out.tombs[k] = d.tombs[k]; });
  return out;
}
function merge(a, b) {
  a = a || {}; b = b || {};
  const tombs = Object.assign({}, a.tombs);
  Object.keys(b.tombs || {}).forEach((k) => { tombs[k] = Math.max(tombs[k] || 0, b.tombs[k]); });
  const out = { ver: 3, tombs };
  ["notebooks", "pages", "labels"].forEach((k) => {
    const m = {};
    [].concat(a[k] || [], b[k] || []).forEach((r) => { if (!m[r.id] || (r.mtime || 0) > (m[r.id].mtime || 0)) m[r.id] = r; });
    out[k] = Object.keys(m).map((id) => m[id]).filter((r) => !((tombs[KEY[k](r.id)] || -1) >= (r.mtime || 0)));
  });
  return canon(out);
}
const H = NHm.make({ merge, canon });
const NOW = Date.now();

function data() {
  return canon({
    notebooks: [{ id: "nbHome", name: "Σπίτι", mtime: 5, pos: 0 }, { id: "nbMine", name: "Mine", mtime: 5, pos: 1 }],
    pages: [{ id: "pg1", nb: "nbHome", parent: null, title: "Ψώνια", text: "γάλα", mtime: 6, ct: 6, st: 6, h: [3], pos: 0, labels: ["lb1"], pinned: false },
            { id: "pg2", nb: "nbHome", parent: "pg1", title: "Sub", text: "x", mtime: 6, pos: 1, labels: [], pinned: false },
            { id: "pg3", nb: "nbMine", parent: null, title: "Private", text: "secret", mtime: 6, pos: 0, labels: [], pinned: false }],
    labels: [{ id: "lb1", nb: "nbHome", name: "Urgent", color: "#e06c75", mtime: 5, pos: 0 }],
    tombs: {}
  });
}
function shareHome(own) { return C.apply(C.empty("notes"), { set: H.project(H.only(own, "nbHome")).items, m: { t: "Σπίτι" } }, 10, "m1"); }
function moveOut(own, nb, now) {
  const d = j(own), moved = {};
  H.moved(own, nb).forEach((id) => { moved[id] = 1; });
  ["notebooks", "pages", "labels"].forEach((k) => { d[k] = d[k].filter((r) => !moved[r.id]); });
  H.tombs(own, nb).forEach((k) => { d.tombs[k] = now; });
  return canon(d);
}

test("the notebook with its pages and labels travels; round trip sends nothing; no stamps", () => {
  const own = data();
  const doc = shareHome(own);
  const b = H.build(C.view(doc)).data;
  assert.deepEqual(b.notebooks.map((n) => n.id), ["nbHome"]);
  assert.deepEqual(b.pages.map((p) => p.id), ["pg1", "pg2"]);
  assert.deepEqual(b.labels.map((l) => l.id), ["lb1"]);
  assert.equal("m" in b.pages[0], false, "item stamps stay out of the records");
  assert.deepEqual(b.pages[0], own.pages[0], "a page arrives exactly as it was");
  const r = H.W.push(H.W.fromDoc(C.view(doc)), H.window(b), null, []);
  assert.equal(r.diff, null);
  assert.deepEqual(H.tombs(own, "nbHome"), ["lbl:lb1", "nb:nbHome", "pg1", "pg2"]);
});

test("union shows each page once; split routes an edit; own tombstones of shared records stay out", () => {
  const own = moveOut(data(), "nbHome", NOW);
  assert.deepEqual(own.notebooks.map((n) => n.id), ["nbMine"]);
  const sets = [{ key: "b/d", data: H.build(C.view(shareHome(data()))).data }];
  const u = H.union(own, sets);
  assert.deepEqual(u.pages.map((p) => p.id), ["pg1", "pg2", "pg3"]);
  assert.deepEqual(u.tombs, {}, "the tombstones of what moved are not on screen");
  const next = j(u);
  next.pages.push({ id: "pg4", nb: "nbHome", parent: null, title: "New", text: "shared", mtime: 30, pos: 2, labels: [], pinned: false });
  next.pages.push({ id: "pg5", nb: "nbMine", parent: null, title: "New mine", text: "own", mtime: 31, pos: 1, labels: [], pinned: false });
  const sp = H.split(next, sets);
  assert.deepEqual(sp.parts[0].pages.map((p) => p.id), ["pg1", "pg2", "pg4"]);
  assert.deepEqual(sp.own.pages.map((p) => p.id), ["pg3", "pg5"]);
  assert.deepEqual(sp.parts[0].labels.map((l) => l.id), ["lb1"]);
});

test("an own page written into the shared notebook on another device shows and goes to the household", () => {
  const own = j(moveOut(data(), "nbHome", NOW));
  own.pages.push({ id: "pg9", nb: "nbHome", parent: null, title: "From the phone", text: "t", mtime: NOW + 5, pos: 3, labels: [], pinned: false });
  const sets = [{ key: "b/d", data: H.build(C.view(shareHome(data()))).data }];
  const u = H.union(canon(own), sets);
  assert.ok(u.pages.some((p) => p.id === "pg9"));
  assert.ok(H.split(u, sets).parts[0].pages.some((p) => p.id === "pg9"));
});

test("stop sharing: the copy comes back over the nb:/lbl: tombstones, newer than them", () => {
  const own = moveOut(data(), "nbHome", NOW);
  const copy = H.copyOf(C.view(shareHome(data())), NOW + 50);
  assert.equal(copy.pages[0].ct, 6, "the text clock stays");
  assert.equal(copy.pages[0].st, NOW + 50);
  const back = merge(own, copy);
  assert.deepEqual(back.notebooks.map((n) => n.id), ["nbHome", "nbMine"]);
  assert.deepEqual(back.pages.map((p) => p.id), ["pg1", "pg2", "pg3"]);
  assert.deepEqual(back.labels.map((l) => l.id), ["lb1"]);
});

test("a long page or a big notebook is not shared", () => {
  const d = j(data());
  d.pages[1].text = "x".repeat(NHm.PAGE_MAX + 10);
  assert.equal(H.fits(canon(d), "nbHome"), "long");
  assert.deepEqual(H.long(H.only(canon(d), "nbHome")), ["pg2"]);
  assert.equal(H.fits(canon(d), "nbMine"), "");
  const e = j(data());
  for (let i = 0; i < 10; i++) e.pages.push({ id: "big" + i, nb: "nbMine", parent: null, title: "B", text: "y".repeat(50000), mtime: 7, pos: i, labels: [], pinned: false });
  assert.equal(H.fits(canon(e), "nbMine"), "full");
});

test("a page as long as allowed still travels whole", () => {
  const d = j(data());
  d.pages[0].text = "«ά\"\\\n".repeat(Math.floor((NHm.PAGE_MAX - 400) / 12));
  const own = canon(d);
  assert.equal(H.fits(own, "nbHome"), "");
  const doc = shareHome(own);
  assert.equal(H.build(C.view(doc)).data.pages[0].text, d.pages[0].text);
});
