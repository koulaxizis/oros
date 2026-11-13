// Files › Photos › Albums (files/albums-core.js, ALB v1): virtual
// albums synced in the slice "files-photos". Merge laws (R5, R17,
// R26), stamps that always win locally, R27 (an unchanged edit keeps
// the same state), tombs, caps, hostile input, resolve by hash and
// path, carry on a move inside Files.
// Run: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../files/albums-core.js");

const H1 = "a".repeat(64), H2 = "b".repeat(64), H3 = "c".repeat(64);
const seq = (s) => () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
const J = (o) => JSON.stringify(o);

function base() {
  let s = A.norm(null);
  const r = A.create(s, "Holidays", 1000, seq(7));
  s = A.addItems(r.state, r.id, [{ k: "h:" + H1, p: "/internal/Pictures/a.jpg" }, { k: "p:/internal/Pictures/b.png", p: "/internal/Pictures/b.png" }], 1100);
  return { s, id: r.id };
}

test("empty and hostile input normalise to an empty state", () => {
  assert.deepEqual(A.norm(null), { v: 1, albums: [], tombs: {} });
  const junk = A.norm({ albums: [null, 1, { id: "x" }, { id: "a-ok", m: -1 }, { id: "a-ok2", m: 5, n: "\u0000 Hi \n there ", it: [
    { k: "h:zz", p: "/internal/a" }, { k: "p:/etc/passwd", p: "/etc/passwd" }, { k: "p:/internal/../x", p: "/internal/../x" },
    { k: "h:" + H1, p: "/internal/ok.jpg", m: 3 }, { k: "h:" + H2, p: "/internal/ok2.jpg" }] }], tombs: { "a-x": "no", "bad": 5 } });
  assert.equal(junk.albums.length, 1);
  assert.equal(junk.albums[0].n, "Hi there");
  assert.deepEqual(junk.albums[0].it, [{ k: "h:" + H1, p: "/internal/ok.jpg", m: 3 }]);
  assert.deepEqual(junk.tombs, {});
});

test("create, rename, cover, add, remove items; unchanged edits keep the state (R27)", () => {
  const { s, id } = base();
  const a = A.find(s, id);
  assert.equal(a.n, "Holidays");
  assert.equal(A.live(a).length, 2);
  assert.equal(A.rename(s, id, " Holidays ", 2000), s);
  assert.equal(A.addItems(s, id, [{ k: "h:" + H1, p: "/internal/Pictures/a.jpg" }], 2000), s);
  assert.equal(A.removeItems(s, id, ["h:" + H3], 2000), s);
  assert.equal(A.create(s, "   ", 2000).state, s);
  const s2 = A.setCover(A.rename(s, id, "Summer", 1200), id, "h:" + H1, 1300);
  assert.equal(A.find(s2, id).n, "Summer");
  assert.equal(A.find(s2, id).cv, "h:" + H1);
  assert.equal(A.setCover(s2, id, "h:" + H1, 1400), s2);
  const s3 = A.removeItems(s2, id, ["h:" + H1], 1500);
  const a3 = A.find(s3, id);
  assert.equal(A.live(a3).length, 1);
  assert.equal(a3.cv, undefined, "removing the cover clears it");
  assert.equal(a3.it.find((x) => x.k === "h:" + H1).x, 1, "a removed item stays as a removal");
  // An add after a removal brings it back with a newer stamp, even with an old clock.
  const s4 = A.addItems(s3, id, [{ k: "h:" + H1, p: "/internal/Pictures/a.jpg" }], 10);
  assert.equal(A.live(A.find(s4, id)).length, 2);
  assert.ok(A.find(s4, id).it.find((x) => x.k === "h:" + H1).m > 1500);
  // The input states are never changed.
  assert.equal(A.live(A.find(s, id)).length, 2);
  assert.equal(A.find(s, id).n, "Holidays");
});

test("merge is symmetric, associative, idempotent and canonical (R5, R26)", () => {
  const { s, id } = base();
  const x = A.addItems(A.rename(s, id, "X side", 2000), id, [{ k: "h:" + H2, p: "/internal/x/2.jpg" }], 2100);
  const y = A.removeItems(A.rename(s, id, "Y side", 2000), id, ["p:/internal/Pictures/b.png"], 2050);
  const z0 = A.create(s, "Other", 2200, seq(9));
  const z = A.addItems(z0.state, z0.id, [{ k: "h:" + H3, p: "/internal/z.jpg" }], 2300);
  const xy = A.merge(x, y);
  assert.equal(J(xy), J(A.merge(y, x)));
  assert.equal(J(A.merge(A.merge(x, y), z)), J(A.merge(x, A.merge(y, z))));
  assert.equal(J(A.merge(xy, xy)), J(xy));
  assert.equal(J(A.merge(xy, A.norm(JSON.parse(J(xy))))), J(xy));
  const a = A.find(xy, id);
  // Equal field stamps: the larger canonical JSON wins on both sides.
  assert.equal(a.n, "Y side");
  assert.deepEqual(A.live(a).map((i) => i.k).sort(), ["h:" + H1, "h:" + H2]);
});

test("equal item stamps: the removal wins", () => {
  const { s, id } = base();
  const x = A.addItems(s, id, [{ k: "h:" + H2, p: "/internal/2.jpg" }], 5000);
  const y = A.removeItems(A.addItems(s, id, [{ k: "h:" + H2, p: "/internal/2.jpg" }], 4000), id, ["h:" + H2], 5000);
  assert.equal(A.find(y, id).it.find((i) => i.k === "h:" + H2).m, 5000);
  const m = A.merge(x, y);
  assert.equal(A.find(m, id).it.find((i) => i.k === "h:" + H2).x, 1);
  assert.equal(J(m), J(A.merge(y, x)));
});

test("a deleted album stays deleted unless edited later elsewhere (R17)", () => {
  const { s, id } = base();
  const del = A.remove(s, id, 3000);
  assert.equal(A.find(del, id), null);
  assert.equal(del.tombs[id], 3000);
  assert.equal(A.find(A.merge(del, s), id), null, "an old copy does not bring it back");
  const later = A.addItems(s, id, [{ k: "h:" + H3, p: "/internal/3.jpg" }], 4000);
  const back = A.merge(del, later);
  assert.ok(A.find(back, id), "an edit after the delete brings it back");
  assert.equal(back.tombs[id], 3000, "the tomb stays");
  assert.equal(A.find(A.merge(back, s), id).n, "Holidays");
  // A delete after the newest item stamp still wins with a slow clock.
  const del2 = A.remove(later, id, 10);
  assert.equal(A.find(del2, id), null);
  assert.equal(A.find(A.merge(del2, later), id), null);
});

test("caps: albums, live items, removed items, tombs", () => {
  let s = A.norm(null);
  const albums = [];
  for (let i = 0; i < A.MAX_ALBUMS + 3; i++) albums.push({ id: "a-n" + i, m: 1 + i, n: "A" + i, it: [] });
  s = A.norm({ albums });
  assert.equal(s.albums.length, A.MAX_ALBUMS);
  assert.ok(!s.albums.find((a) => a.id === "a-n0"), "the oldest go first");
  assert.equal(A.create(s, "One more", 9e12).state, s);
  const it = [];
  for (let i = 0; i < A.MAX_ITEMS + 5; i++) it.push({ k: "p:/internal/p/" + i + ".jpg", p: "/internal/p/" + i + ".jpg", m: 1 + i });
  for (let i = 0; i < 1005; i++) it.push({ k: "p:/internal/g/" + i + ".jpg", p: "/internal/g/" + i + ".jpg", m: 1 + i, x: 1 });
  const big = A.norm({ albums: [{ id: "a-big", m: 1, n: "Big", it }] }).albums[0];
  assert.equal(A.live(big).length, A.MAX_ITEMS);
  assert.equal(big.it.length - A.MAX_ITEMS, 1000);
  const tombs = {};
  for (let i = 0; i < 520; i++) tombs["a-t" + i] = 1 + i;
  assert.equal(Object.keys(A.norm({ tombs }).tombs).length, 500);
});

test("keyOf, resolve by hash, path and last known path; albumsWith", () => {
  const { s, id } = base();
  assert.equal(A.keyOf({ k: "/internal/x.jpg", h: H1 }), "h:" + H1);
  assert.equal(A.keyOf({ k: "/internal/x.jpg" }), "p:/internal/x.jpg");
  assert.equal(A.keyOf({ k: "/etc/x" }), "");
  const recs = [
    { k: "/internal/Moved/a.jpg", h: H1 },          // moved elsewhere, found by hash
    { k: "/internal/Pictures/b.png" }                // found by path
  ];
  const r = A.resolve(A.find(s, id), recs);
  assert.deepEqual(r.recs.map((x) => x.k), ["/internal/Moved/a.jpg", "/internal/Pictures/b.png"]);
  assert.equal(r.missing, 0);
  assert.equal(A.resolve(A.find(s, id), []).missing, 2);
  assert.deepEqual(A.albumsWith(s, "h:" + H1), [id]);
  assert.deepEqual(A.albumsWith(s, "h:" + H3), []);
});

test("carry: a move inside Files keeps path-keyed items", () => {
  const { s, id } = base();
  const c = A.carry(s, "/internal/Pictures", "/internal/Trips/2026", 5000);
  const live = A.live(A.find(c, id)).map((i) => i.k + " " + i.p).sort();
  assert.deepEqual(live, [
    "h:" + H1 + " /internal/Trips/2026/a.jpg",
    "p:/internal/Trips/2026/b.png /internal/Trips/2026/b.png"
  ]);
  assert.equal(A.carry(s, "/internal/Elsewhere", "/internal/X", 5000), s);
  assert.equal(A.carry(s, "/internal/a", "/internal/a", 5000), s);
});
