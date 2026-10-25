// A vehicle shared with a household (garage/house.js, BR-HH wave 7e;
// household/group.js): the vehicle and all its rows travel, settings
// never; a built copy projects back to its document (no endless
// uploads); the union shows each record once and the shared car's
// reminders once; an edit goes back where each record lives; stopping
// brings everything back over the tombstones; a vehicle with too many
// records is refused rather than split.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../garage/core.js");
const H = require("../garage/house.js");
const C = require("../household/core.js");

const j = (x) => JSON.parse(JSON.stringify(x));
const NOW = Date.now();       // tombstones expire after a year, so they need a real clock
function data() {
  return G.merge({
    ver: 1,
    vehicles: [{ id: "car001", m: 5, name: "Οικογενειακό", type: "car", fuel: "petrol", col: 0 },
               { id: "bike01", m: 5, name: "Vespa", type: "scooter", fuel: "petrol", col: 1 }],
    fuel: [{ id: "fu0001", m: 6, v: "car001", d: "2026-10-01", km: 50000, q: 40000, c: 7000 },
           { id: "fu0002", m: 6, v: "bike01", d: "2026-10-02", km: 9000, q: 6000, c: 1100 }],
    renewals: [{ id: "rn0001", m: 6, v: "car001", kind: "ins", exp: "2026-10-30", c: 30000 }],
    odo: [{ id: "od0001", m: 6, v: "car001", d: "2026-10-10", km: 50400 }],
    settings: { m: 3, cur: "EUR" }, tombs: {}
  }, null);
}
function shareCar(own) { return C.apply(C.empty("garage"), { set: H.project(H.only(own, "car001")).items, m: { t: "Οικογενειακό" } }, 10, "m1"); }
function tomb(own, ids, now) { const d = j(own); ids.forEach((id) => { d.tombs[id] = now; }); return G.merge(d, d); }

test("the vehicle and all its rows travel; settings never; round trip sends nothing", () => {
  const own = data();
  assert.equal(G.vehicle(own, "car001").name, "Οικογενειακό");
  const doc = shareCar(own);
  const b = H.build(C.view(doc)).data;
  assert.deepEqual(b.vehicles.map((v) => v.id), ["car001"]);
  assert.deepEqual(b.fuel.map((x) => x.id), ["fu0001"]);
  assert.equal(b.renewals.length, 1);
  assert.equal(b.odo.length, 1);
  const r = H.W.push(H.W.fromDoc(C.view(doc)), H.window(b), null, []);
  assert.equal(r.diff, null);
  assert.deepEqual(H.moved(own, "car001"), ["car001", "fu0001", "od0001", "rn0001"]);
});

test("union: the shared car's renewal alerts once; split routes an edit", () => {
  const own0 = data();
  const doc = shareCar(own0);
  const own = tomb(own0, H.moved(own0, "car001"), NOW);
  assert.deepEqual(own.vehicles.map((v) => v.id), ["bike01"]);
  const sets = [{ key: "b/d", data: H.build(C.view(doc)).data }];
  const u = H.union(own, sets);
  assert.deepEqual(u.vehicles.map((v) => v.id).sort(), ["bike01", "car001"]);
  const alerts = G.alerts(u, "2026-10-25", G.readPrefs(null)).filter((a) => a.key.indexOf("rrn0001") === 0);
  assert.equal(alerts.length, 1, "one insurance alert");
  const next = j(u);
  next.fuel.push({ id: "fu0003", m: 30, v: "car001", d: "2026-10-20", km: 50600, q: 38000, c: 6800 });
  next.fuel.push({ id: "fu0004", m: 31, v: "bike01", d: "2026-10-21", km: 9100, q: 5000, c: 950 });
  next.settings = { m: 32, cur: "USD" };
  const sp = H.split(next, sets);
  assert.deepEqual(sp.parts[0].fuel.map((x) => x.id), ["fu0001", "fu0003"]);
  assert.deepEqual(sp.own.fuel.map((x) => x.id), ["fu0002", "fu0004"]);
  assert.equal(sp.own.settings.cur, "USD");
  assert.equal(sp.parts[0].settings.cur, "EUR", "the settings stay own");
});

test("stop sharing: the copy comes back over the tombstones", () => {
  const own0 = data();
  const doc = shareCar(own0);
  const own = tomb(own0, H.moved(own0, "car001"), NOW);
  assert.deepEqual(own.vehicles.map((v) => v.id), ["bike01"]);
  const back = G.merge(own, H.copyOf(C.view(doc), NOW + 50));
  assert.deepEqual(back.vehicles.map((v) => v.id).sort(), ["bike01", "car001"]);
  assert.equal(back.fuel.length, 2);
  assert.equal(back.odo.length, 1);
});

test("a vehicle with too many records is not shared", () => {
  const d = j(data());
  for (let i = 0; i < H.ROW_MAX; i++) d.odo.push({ id: "odx" + String(i).padStart(5, "0"), m: 7, v: "car001", d: "2026-01-01", km: 1000 + i });
  const own = G.merge(d, null);
  assert.equal(H.fits(own, "car001"), false);
  assert.equal(H.fits(own, "bike01"), true);
});

test("mirror and readers", () => {
  const doc = shareCar(data());
  const m = {};
  const ls = { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
  const Hh = { docs: () => [{ box: "b1", id: "d1", hh: "Σπίτι", ready: true }], view: () => C.view(doc) };
  assert.equal(H.mirror(Hh, ls), true);
  assert.equal(H.mirror(Hh, ls), false);
  const u = H.withShared(null, ls);
  assert.deepEqual(u.vehicles.map((v) => v.id), ["car001"]);
});
