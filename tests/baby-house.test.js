// Baby shared with a household (baby/house.js, BR-HH wave 7b): a built
// Baby projects back to its document (no endless uploads), a feed one
// parent logs is the other's last feed (the reminder rule sees it), a
// running timer stopped on the other phone is one event, deleted
// records and old events do not travel, and the mirror is written
// only on a change.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../baby/core.js");
const H = require("../baby/house.js");
const C = require("../household/core.js");

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
const j = (x) => JSON.parse(JSON.stringify(x));
function data() {
  return B.normalize({
    ver: 1,
    kids: [{ id: "kid0001", n: "Ελένη", b: "2026-06-01", s: "f", c: 2, m: 5 }],
    ev: [{ id: "ev00001", k: "kid0001", t: "feed", ts: NOW - 3 * 3600000, e: NOW - 3 * 3600000 + 900000, ls: 400, rs: 500, m: 6 },
         { id: "ev00002", k: "kid0001", t: "diaper", ts: NOW - 3600000, x: "w", m: 6 },
         { id: "ev00003", k: "kid0001", t: "sleep", ts: NOW - 1800000, m: 6 },
         { id: "ev00004", k: "kid0001", t: "diaper", ts: NOW - 200 * 86400000, x: "d", m: 6 },
         { id: "ev00005", m: 7, del: 1 }],
    gr: [{ id: "gr00001", k: "kid0001", d: "2026-10-01", g: 6200, l: 620, m: 6 }],
    mk: [{ id: "kid0001xsmile", k: "kid0001", t: "ms", key: "smile", d: "2026-07-20", m: 6 }],
    prefs: { wu: "lb", tu: "c", vu: "oz" }, pm: 3
  });
}
function share(d, t, by) { return C.apply(C.empty("baby"), { set: H.project(d, NOW).items, m: { t: "Home" } }, t, by); }
function edit(doc, after, t, by) {
  const r = H.W.push(H.W.fromDoc(C.view(doc)), H.window(after, NOW), null, H.build(C.view(doc)).raw);
  return r.diff ? C.apply(doc, { set: r.diff.set, del: r.diff.del }, t, by) : doc;
}

test("a built Baby projects back to its document: nothing to send", () => {
  const doc = share(data(), 10, "m1");
  const b = H.build(C.view(doc));
  assert.equal(b.data.kids[0].n, "Ελένη");
  assert.deepEqual(b.data.ev.map((e) => e.id), ["ev00001", "ev00002", "ev00003"]);
  assert.equal(b.data.ev.find((e) => e.id === "ev00003").e, undefined, "the running sleep still runs");
  assert.equal(b.data.mk[0].id, "kid0001xsmile");
  assert.equal(edit(doc, b.data, 11, "m1"), doc);
  assert.deepEqual(H.moved(data(), NOW).ev, ["ev00001", "ev00002", "ev00003"]);
});

test("a feed one parent logs is the other's last feed; a stopped timer is one event", () => {
  const doc = share(data(), 10, "m1");
  const base = H.build(C.view(doc)).data;
  const dad = j(base);
  dad.ev.push({ id: "ev00009", k: "kid0001", t: "bottle", ts: NOW - 600000, ml: 120, x: "fm", m: 20 });
  const mum = j(base);
  const s = mum.ev.find((e) => e.id === "ev00003"); s.e = NOW - 60000; s.m = 21;
  const M = C.merge(edit(doc, dad, 20, "m2"), edit(doc, mum, 21, "m1"));
  const out = H.build(C.view(M)).data;
  assert.equal(out.ev.find((e) => e.id === "ev00003").e, NOW - 60000);
  assert.equal(out.ev.filter((e) => e.t === "sleep").length, 1);
  const rem = B.reminderDue(out, { feed: 120 }, NOW + 125 * 60000);
  assert.equal(rem.length, 1);
  assert.equal(rem[0].last.id, "ev00009");
});

test("a deleted record leaves the document", () => {
  const doc = share(data(), 10, "m1");
  const next = j(H.build(C.view(doc)).data);
  next.gr = [{ id: "gr00001", m: 30, del: 1 }];
  const doc2 = edit(doc, next, 30, "m1");
  assert.ok(doc2.dt["g:gr00001"]);
  assert.equal(H.build(C.view(doc2)).data.gr.length, 0);
});

test("an own copy is stamped now; the mirror is written only on a change", () => {
  const doc = share(data(), 10, "m1");
  const c = H.copyOf(C.view(doc), 99999);
  assert.ok(c.kids.every((k) => k.m === 99999));
  const Hh = { docs: () => [{ box: "b", id: "d1", ready: true, hh: "Home" }], view: () => C.view(doc) };
  const m = {}, ls = { setItem: (k, v) => { m[k] = v; }, removeItem: (k) => { delete m[k]; } };
  assert.equal(H.mirror(Hh, ls), true);
  assert.equal(H.mirror(Hh, ls), false);
  const sets = H.readMirror(JSON.parse(m[H.MIRROR_KEY]));
  assert.equal(sets[0].data.kids[0].n, "Ελένη");
});

test("union: a moved child is counted once, own tombstones never hide it", () => {
  const own = j(data());
  const doc = share(own, 10, "m1");
  const set = { id: "d1", t: "Home", hh: "Home", data: H.build(C.view(doc)).data };
  const ids = H.moved(own, NOW);
  Object.keys(ids).forEach((f) => ids[f].forEach((id) => {
    const i = own[f].findIndex((x) => x.id === id);
    own[f][i] = { id, m: own[f][i].m + 1, del: 1 };
  }));
  const u = H.union(B.normalize(own), [set]);
  assert.equal(B.liveKids(u).length, 1);
  assert.ok(u.ev.some((e) => e.id === "ev00004" && !e.del), "an old own event stays");
  assert.equal(u.prefs.wu, "lb", "units are the own ones");
  const due = B.reminderDue(u, { feed: 120 }, NOW);
  assert.equal(due.filter((x) => x.kind === "feed").length, 1);
});
