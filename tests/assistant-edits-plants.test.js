// change_item adapter for Plant Care: wired into a copy of
// assistant/edits.js, checked against plants/core.js merge.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const E = require(path.join(REPO, "assistant/edits.js"));
const C = require(path.join(REPO, "plants/core.js"));

const NOW = new Date(2026, 9, 14, 0, 30).getTime();   // local 2026-10-14, just after midnight
const TODAY = "2026-10-14";
const T0 = NOW - 86400000 * 4;
const P1 = "plant00001", P2 = "plant00002";
function plant(id, over) {
  return Object.assign({ id, m: T0, name: "Basil " + id, sp: "", room: "Kitchen", out: 0, em: "", w: 3, ww: 0, f: 0, mi: 0, r: 0,
    st: "2026-10-01", sn: {}, notes: "" }, over || {});
}
function data() {
  return C.merge({ ver: 1, plants: [plant(P1, { sn: { water: "2026-10-16", mist: "2026-10-20" } }), plant(P2, { notes: "sunny" })],
    log: [{ id: "log0000001", p: P1, k: "water", d: "2026-10-10", s: 0, m: T0 }], tombs: {} }, null, NOW);
}
const ch = (args) => { const r = E.normArgs(Object.assign({ ref: "r1" }, args)); assert.ok(r.ok, r.err); return r; };
function run(d, target, c, now) {
  const p = E.plan("plants", d, target, c, now);
  assert.ok(p.ok, p.err);
  const a = E.apply("plants", d, target, c, now, p.before);
  assert.ok(a.ok, a.err);
  return { p, a };
}
const due = (d, id) => {
  const pl = d.plants.find((x) => x.id === id), last = C.lastByKind(d);
  return C.nextDue(pl, "water", last[id] && last[id].water, "n");
};

test("plants: wired; complete + update only", () => {
  assert.equal(E.storageKey("plants"), "oros-plants-data");
  assert.deepEqual(E.actionsFor("plants"), ["complete", "update"]);
  assert.equal(E.plan("plants", data(), P1, ch({ action: "delete" }), NOW).ok, false);
});

test("plants: complete = the Water button: a log entry for local today, postponement cleared, next due moves", () => {
  const d = data();
  assert.equal(due(d, P1), "2026-10-16");                          // the postponement
  const { p, a } = run(d, P1, ch({ action: "complete" }), NOW);
  assert.deepEqual(p.rows, [{ f: "watered", b: "2026-10-10", a: TODAY }]);
  const e = a.data.log.find((x) => x.d === TODAY);
  assert.deepEqual(Object.keys(e), ["id", "p", "k", "d", "s", "m"]);
  assert.equal(e.p, P1); assert.equal(e.k, "water"); assert.equal(e.s, 0); assert.equal(e.m, NOW);
  assert.ok(C.ID_RE.test(e.id));
  const pl = a.data.plants.find((x) => x.id === P1);
  assert.deepEqual(pl.sn, { mist: "2026-10-20" });
  assert.ok(pl.m > T0);
  assert.deepEqual(a.data, C.merge(a.data, a.data, NOW));            // canonical
  const m = C.merge(d, a.data, NOW);
  assert.deepEqual(m, C.merge(a.data, d, NOW));
  assert.equal(due(m, P1), "2026-10-17");                          // today + 3
  assert.equal(C.tasks(m, TODAY, 0, "n").filter((t) => t.kind === "water" && t.plant.id === P1).length, 0);
  assert.match(E.plan("plants", a.data, P1, ch({ action: "complete" }), NOW + 1000).err, /already watered/);
  assert.ok(d.plants[0].sn.water);                                  // input untouched
});

test("plants: a plant without a postponement keeps its m; object target works too", () => {
  const { a } = run(data(), { id: P2 }, ch({ action: "complete" }), NOW);
  assert.equal(a.data.plants.find((x) => x.id === P2).m, T0);
  assert.equal(a.data.log.length, 2);
});

test("plants: update name and notes, stamp newer than a future-dated copy, refusals", () => {
  const d = data(); d.plants[1].m = NOW + 7000;
  const { p, a } = run(d, P2, ch({ action: "update", title: "Basil on the sill, the big one with long leaves", note: "water \nfrom below" }), NOW);
  assert.deepEqual(p.rows.map((r) => r.f), ["title", "note"]);
  const pl = a.data.plants.find((x) => x.id === P2);
  assert.equal(pl.name.length, 40);
  assert.equal(pl.notes, "water\nfrom below");
  assert.equal(pl.m, NOW + 7001);
  assert.equal(C.merge(d, a.data, NOW).plants.find((x) => x.id === P2).notes, "water\nfrom below");
  assert.match(E.plan("plants", data(), P1, ch({ action: "update", date: "2026-10-20" }), NOW).err, /no date/);
  assert.match(E.plan("plants", data(), P2, ch({ action: "update", note: "sunny" }), NOW).err, /Nothing/);
  assert.match(E.plan("plants", data(), "plant99999", ch({ action: "update", title: "x" }), NOW).err, /no longer/);
  const gone = data(); gone.tombs[P2] = NOW;
  assert.match(E.plan("plants", gone, P2, ch({ action: "update", title: "x" }), NOW).err, /no longer/);
});

test("plants: undo of a watering tombstones the entry and brings the postponement back; wins the merge", () => {
  const d = data();
  const { a } = run(d, P1, ch({ action: "complete" }), NOW);
  const u = E.undo("plants", a.data, a.undo, NOW + 500);
  assert.ok(u.ok, u.err);
  const m = C.merge(a.data, u.data, NOW + 500);                       // the other device still has the entry
  assert.ok(!m.log.some((x) => x.d === TODAY));
  assert.deepEqual(m.plants.find((x) => x.id === P1).sn, { water: "2026-10-16", mist: "2026-10-20" });
  assert.equal(due(m, P1), "2026-10-16");
  assert.deepEqual(u.data, C.merge(u.data, u.data, NOW + 500));
  assert.match(E.undo("plants", u.data, a.undo, NOW + 600).err, /no longer/);
});

test("plants: undo of an edit; refused after a later change", () => {
  const { a } = run(data(), P2, ch({ action: "update", note: "shade" }), NOW);
  const b = JSON.parse(JSON.stringify(a.data)); b.plants[1].notes = "other";
  assert.match(E.undo("plants", b, a.undo, NOW + 10).err, /changed since/);
  const u = E.undo("plants", a.data, a.undo, NOW + 10);
  assert.ok(u.ok);
  assert.equal(C.merge(a.data, u.data, NOW).plants.find((x) => x.id === P2).notes, "sunny");
});

test("plants: conflict — watered on another device after the plan", () => {
  const d = data(), c = ch({ action: "complete" });
  const p = E.plan("plants", d, P1, c, NOW);
  const later = JSON.parse(JSON.stringify(d));
  later.log.push({ id: "log0000009", p: P1, k: "water", d: "2026-10-13", s: 0, m: NOW - 5 });
  const r = E.apply("plants", later, P1, c, NOW, p.before);
  assert.equal(r.ok, false); assert.equal(r.conflict, true);
});
