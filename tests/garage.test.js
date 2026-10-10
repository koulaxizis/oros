// Pure logic of Garage (garage/core.js): dates, number parsing,
// full-to-full consumption, service plans by km and months, renewals
// and their reminder steps, tyres, money, CSV and the sync merge
// (slice "garage").
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const C = require(path.join(__dirname, "..", "garage/core.js"));

const NOW = Date.UTC(2026, 9, 9, 10, 0, 0);   // 2026-10-09
const TODAY = "2026-10-09";

function veh(id, extra) {
  return Object.assign({ id, m: 1000, name: "Car " + id, type: "car", fuel: "petrol" }, extra || {});
}
function fill(id, v, d, km, litres, extra) {
  return Object.assign({ id, m: 1000, v, d, km, q: Math.round(litres * 1000), c: Math.round(litres * 180) }, extra || {});
}
function data(o) {
  return Object.assign({ vehicles: [], fuel: [], service: [], plans: [], tyres: [], renewals: [], costs: [], odo: [], tombs: {} }, o || {});
}
function m(a, b) { return C.merge(a, b, NOW); }
function near(a, b, eps) { assert.ok(Math.abs(a - b) < (eps || 1e-9), a + " ≉ " + b); }

test("dates: whole days and calendar months, clamped to month end", () => {
  assert.equal(C.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(C.addDays("2026-03-28", 2), "2026-03-30");
  assert.equal(C.addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(C.addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(C.addMonths("2026-10-09", 24), "2028-10-09");
  assert.equal(C.addMonths("2026-11-15", 3), "2027-02-15");
  assert.equal(C.addMonths("2026-03-15", -4), "2025-11-15");
  assert.ok(C.isYmd("2028-02-29"));
  assert.ok(!C.isYmd("2026-02-29"));
  assert.ok(!C.isYmd("1800-01-01"));
});

test("parseNum: comma or dot decimals, thousands groups, junk refused", () => {
  assert.equal(C.parseNum("42,3", "el"), 42.3);
  assert.equal(C.parseNum("42.3", "en"), 42.3);
  assert.equal(C.parseNum("42.3", "el"), 42.3);
  assert.equal(C.parseNum("1.234,56", "el"), 1234.56);
  assert.equal(C.parseNum("1,234.56", "en"), 1234.56);
  assert.equal(C.parseNum("1.234", "el"), 1234);        // Greek thousands
  assert.equal(C.parseNum("1.234", "en"), 1.234);
  assert.equal(C.parseNum("123 456", "el"), 123456);
  assert.equal(C.parseNum("12.345.678", "en"), 12345678);
  assert.equal(C.parseNum("1,234,567", "en"), 1234567);
  assert.equal(C.parseNum("", "en"), null);
  assert.equal(C.parseNum("12a", "en"), null);
  assert.equal(C.parseNum("1,2,3", "en"), null);
  assert.equal(C.parseNum("1.2.3", "en"), null);
  assert.equal(C.parseNum("=1+1", "en"), null);
});

test("normalizers: strict, invalid rows dropped, text cleaned", () => {
  assert.equal(C.normVehicle(veh("bad id!")), null);
  assert.equal(C.normVehicle(veh("aaaaaa1", { name: "   " })), null);
  assert.equal(C.normVehicle(veh("aaaaaa1", { type: "rocket" })), null);
  const v = C.normVehicle(veh("aaaaaa1", { name: " My\u0000  car ", fuel: "warp", year: 3000, col: 9 }));
  assert.equal(v.name, "My car");
  assert.equal(v.fuel, "petrol");              // the type's default
  assert.equal(v.year, 0);
  assert.equal(v.col, 0);
  const bike = C.normVehicle(veh("bbbbbb1", { type: "bike", fuel: undefined }));
  assert.equal(bike.fuel, "none");
  assert.equal(C.normFuel(fill("ffffff1", "aaaaaa1", "2026-10-01", -1, 40)), null);
  assert.equal(C.normFuel(fill("ffffff1", "aaaaaa1", "2026-10-01", 1000, 0)), null);
  assert.equal(C.normFuel(fill("ffffff1", "aaaaaa1", "2026-02-30", 1000, 40)), null);
  const f = C.normFuel(fill("ffffff1", "aaaaaa1", "2026-10-01", 1000, 40, { full: 0, e: "x", c: -5 }));
  assert.equal(f.full, 0);
  assert.equal(f.e, "f");
  assert.equal(f.c, 0);
  assert.equal(C.normService({ id: "ssssss1", m: 1, v: "aaaaaa1", d: TODAY, items: ["nope"] }), null);
  const s = C.normService({ id: "ssssss1", m: 1, v: "aaaaaa1", d: TODAY, items: ["brakes", "oil", "oil", "x"], km: "12" });
  assert.deepEqual(s.items, ["oil", "brakes"]);
  assert.equal(s.km, null);
  assert.equal(C.normPlan({ id: "pppppp1", m: 1, v: "aaaaaa1", item: "oil", km: 0, mo: 0, sd: TODAY }), null);
  assert.equal(C.normTyre({ id: "tttttt1", m: 1, v: "aaaaaa1", label: "Winter", dot: "5424" }).dot, "");
  assert.equal(C.normTyre({ id: "tttttt1", m: 1, v: "aaaaaa1", label: "Winter", dot: "0324" }).dot, "0324");
  const r = C.normRenewal({ id: "rrrrrr1", m: 1, v: "aaaaaa1", kind: "kteo", exp: TODAY });
  assert.deepEqual(r.warn, [30, 7, 1]);
  assert.deepEqual(C.normRenewal(Object.assign({}, r, { warn: [1, 400, 7, 7] })).warn, [7, 1]);
  assert.equal(C.normCost({ id: "cccccc1", m: 1, v: "aaaaaa1", d: TODAY, cat: "toll", c: 0 }), null);
  assert.equal(C.normCost({ id: "cccccc1", m: 1, v: "aaaaaa1", d: TODAY, cat: "bribe", c: 100 }), null);
});

test("vehicle classes: items and default plans fit the vehicle", () => {
  assert.ok(C.itemsFor("car").includes("timing"));
  assert.ok(!C.itemsFor("car").includes("chain"));
  assert.ok(C.itemsFor("bike").includes("chain"));
  assert.ok(!C.itemsFor("bike").includes("oil"));
  assert.ok(C.itemsFor("boat").includes("impeller"));
  const bikePlans = C.defaultPlans("bike", "none").map(p => p.item);
  assert.ok(bikePlans.includes("lube") && bikePlans.includes("chain"));
  const ev = C.defaultPlans("car", "ev").map(p => p.item);
  assert.ok(!ev.includes("oil") && !ev.includes("timing") && ev.includes("brakes"));
  const boat = C.defaultPlans("boat", "petrol");
  assert.ok(boat.every(p => p.km === 0 && p.mo > 0));
  assert.equal(C.defaultPlans("moto", "petrol").find(p => p.item === "oil").km, 6000);
  assert.ok(!C.hasFuel(C.normVehicle(veh("bbbbbb1", { type: "bike", fuel: "none" }))));
  assert.deepEqual(C.energies(C.normVehicle(veh("aaaaaa1", { fuel: "phev" }))), ["f", "e"]);
});

test("consumption: full to full, partial fills added, a missed fill breaks the chain", () => {
  const V = "aaaaaa1";
  const d = m(data({
    vehicles: [veh(V)],
    fuel: [
      fill("f000001", V, "2026-09-01", 10000, 30),            // first full: the start
      fill("f000002", V, "2026-09-05", 10300, 10, { full: 0 }),
      fill("f000003", V, "2026-09-10", 10600, 32),            // 42 L / 600 km = 7.0
      fill("f000004", V, "2026-09-20", 11100, 30, { mis: 1 }),// gap before: restart here
      fill("f000005", V, "2026-09-30", 11600, 30)             // 30 L / 500 km = 6.0
    ]
  }), null);
  const c = C.consumption(d, V, "f");
  assert.equal(c.segs.length, 2);
  near(c.segs[0].per100, 7.0);
  near(c.segs[1].per100, 6.0);
  near(c.avg, 72 / 11);                                       // weighted by distance
  near(c.last, 6.0);
  assert.equal(c.dist, 1100);
  // order of entry does not matter (sorted by km)
  const shuffled = Object.assign({}, d, { fuel: d.fuel.slice().reverse() });
  near(C.consumption(shuffled, V, "f").avg, 72 / 11);
  // electricity is a separate chain
  assert.equal(C.consumption(d, V, "e").avg, null);
  // a partial first fill is ignored until a full one starts the chain
  const d2 = m(data({ vehicles: [veh(V)], fuel: [
    fill("f000001", V, "2026-09-01", 10000, 20, { full: 0 }),
    fill("f000002", V, "2026-09-05", 10200, 40),
    fill("f000003", V, "2026-09-09", 10700, 35)
  ] }), null);
  near(C.consumption(d2, V, "f").avg, 7.0);
});

test("current km and km/day from every dated reading", () => {
  const V = "aaaaaa1";
  const d = m(data({
    vehicles: [veh(V)],
    fuel: [fill("f000001", V, "2026-07-11", 20000, 40)],
    service: [{ id: "s000001", m: 1, v: V, d: "2026-08-10", km: 21500, items: ["oil"], c: 0 }],
    odo: [{ id: "o000001", m: 1, v: V, d: "2026-10-09", km: 23000 }]
  }), null);
  assert.equal(C.currentKm(d, V), 23000);
  near(C.kmPerDay(d, V, TODAY), 3000 / 90);
  // a single reading cannot tell a rate
  assert.equal(C.kmPerDay(m(data({ vehicles: [veh(V)], odo: [{ id: "o000001", m: 1, v: V, d: TODAY, km: 1 }] }), null), V, TODAY), null);
});

test("service plans: km or months, whichever first; based on the last service", () => {
  const V = "aaaaaa1";
  const plan = { id: "p000001", m: 1, v: V, item: "oil", km: 10000, mo: 12, sd: "2026-01-01", skm: 15000 };
  let d = m(data({ vehicles: [veh(V)], plans: [plan],
    odo: [{ id: "o000001", m: 1, v: V, d: "2026-07-11", km: 21000 },
          { id: "o000002", m: 1, v: V, d: "2026-10-09", km: 24600 }] }), null);
  let st = C.planStatus(d.plans[0], d, TODAY);
  assert.equal(st.dueKm, 25000);
  assert.equal(st.leftKm, 400);
  assert.equal(st.dueDate, "2027-01-01");
  assert.equal(st.level, "soon");                 // ≤ 500 km
  assert.equal(st.estDate, C.addDays(TODAY, Math.ceil(400 / 40)));   // 3600 km / 90 days = 40/day
  assert.equal(st.when, st.estDate);
  // a service holding the item resets the base
  d = m(d, data({ service: [{ id: "s000001", m: 2, v: V, d: "2026-10-01", km: 24500, items: ["oil", "ofilter"], c: 9000 }] }));
  st = C.planStatus(d.plans[0], d, TODAY);
  assert.equal(st.dueKm, 34500);
  assert.equal(st.dueDate, "2027-10-01");
  assert.equal(st.level, "ok");
  // months only, overdue
  const p2 = C.normPlan({ id: "p000002", m: 1, v: V, item: "ac", km: 0, mo: 24, sd: "2024-09-01" });
  st = C.planStatus(p2, d, TODAY);
  assert.equal(st.level, "due");
  assert.ok(st.leftDays < 0);
  // km plan without any km anywhere: nothing to say, not an alarm
  const lone = m(data({ vehicles: [veh(V)], plans: [{ id: "p000003", m: 1, v: V, item: "brakes", km: 30000, mo: 0, sd: TODAY }] }), null);
  st = C.planStatus(lone.plans[0], lone, TODAY);
  assert.equal(st.dueKm, null);
  assert.equal(st.level, "ok");
});

test("renewals: steps 30 → 7 → 1 → 0, deterministic Renewed action", () => {
  const r = C.normRenewal({ id: "r000001", m: 1, v: "aaaaaa1", kind: "kteo", exp: "2026-11-08", every: 24 });
  assert.equal(C.renewalStatus(r, TODAY).daysLeft, 30);
  assert.equal(C.renewalStatus(r, TODAY).step, 30);
  assert.equal(C.renewalStatus(r, "2026-10-01").step, null);
  assert.equal(C.renewalStatus(r, "2026-11-02").step, 7);
  assert.equal(C.renewalStatus(r, "2026-11-07").step, 1);
  assert.equal(C.renewalStatus(r, "2026-11-08").step, 0);
  assert.equal(C.renewalStatus(r, "2026-11-20").level, "expired");
  const a = C.renewal(r), b = C.renewal(Object.assign({}, r));
  assert.equal(a.costId, b.costId);
  assert.ok(C.ID_RE.test(a.costId));
  assert.equal(a.next, "2028-11-08");
  assert.equal(C.renewal(Object.assign({}, r, { every: 0 })).next, null);
  // a 40-char id still yields a valid cost id
  const long = C.renewal(Object.assign({}, r, { id: "a".repeat(40) }));
  assert.ok(C.ID_RE.test(long.costId));
});

test("alerts: urgent first, archived vehicles silent, one announcement per step", () => {
  const V = "aaaaaa1", W = "wwwwww1";
  const d = m(data({
    vehicles: [veh(V), veh(W, { arch: 1 })],
    renewals: [
      { id: "r000001", m: 1, v: V, kind: "ins", exp: "2026-10-12" },     // 3 days: step 7
      { id: "r000002", m: 1, v: V, kind: "kteo", exp: "2026-10-01" },    // expired
      { id: "r000003", m: 1, v: V, kind: "tax", exp: "2027-06-01" },     // far
      { id: "r000004", m: 1, v: W, kind: "ins", exp: "2026-10-10" }      // archived vehicle
    ]
  }), null);
  const list = C.alerts(d, TODAY, {});
  assert.deepEqual(list.map(a => a.id), ["r000002", "r000001"]);
  assert.equal(list[1].step, 7);
  // already announced at step 7 → silent until step 1
  const notified = { [list[1].key]: 7, [list[0].key]: 0 };
  assert.equal(C.toNotify(list, notified).length, 0);
  const later = C.alerts(d, "2026-10-11", {});
  assert.deepEqual(C.toNotify(later, notified).map(a => a.id), ["r000001"]);
  // renewed → new expiry → new key → fresh cycle
  const renewed = m(d, data({ renewals: [{ id: "r000001", m: 2, v: V, kind: "ins", exp: "2027-10-12" }] }));
  assert.ok(!C.alerts(renewed, TODAY, {}).some(a => a.id === "r000001"));
});

test("tyres: km over mounted periods, age from DOT, worn tread", () => {
  const V = "aaaaaa1";
  const d = m(data({
    vehicles: [veh(V)],
    odo: [{ id: "o000001", m: 1, v: V, d: TODAY, km: 30000 }],
    tyres: [
      { id: "t000001", m: 5, v: V, label: "Summer", season: "s", km: 12000, on: 1, okm: 25000, dot: "1019", tread: 25 },
      { id: "t000002", m: 1, v: V, label: "Winter", season: "w", km: 8000, on: 1, okm: 20000, dot: "4025" }
    ]
  }), null);
  // only one set can be mounted: the newest edit keeps the mount
  assert.equal(d.tyres.filter(t => t.on).length, 1);
  assert.equal(d.tyres.find(t => t.on).id, "t000001");
  const st = C.tyreStatus(d.tyres[0], d, TODAY, {});
  assert.equal(st.km, 17000);
  assert.ok(st.old);                                   // made in 2019
  assert.ok(st.worn);                                  // 2.5 mm < 3.0
  const w = C.tyreStatus(d.tyres[1], d, TODAY, {});
  assert.equal(w.km, 8000);
  assert.ok(!w.old && !w.worn);
  assert.ok(C.alerts(d, TODAY, {}).some(a => a.type === "tyre" && a.level === "worn"));
});

test("money: totals by kind and month, integer cents", () => {
  const V = "aaaaaa1";
  const d = m(data({
    vehicles: [veh(V)],
    fuel: [fill("f000001", V, "2026-09-03", 1000, 40, { c: 7210 }), fill("f000002", V, "2026-10-01", 1500, 30, { c: 5390 })],
    service: [{ id: "s000001", m: 1, v: V, d: "2026-10-02", km: 1500, items: ["oil"], c: 12000 }],
    costs: [{ id: "c000001", m: 1, v: V, d: "2026-08-15", cat: "toll", c: 285 }]
  }), null);
  assert.deepEqual(C.costs(d, V), { fuel: 12600, service: 12000, other: 285, total: 24885 });
  assert.deepEqual(C.costs(d, V, "2026-10-01", "2026-10-31"), { fuel: 5390, service: 12000, other: 0, total: 17390 });
  const mo = C.monthly(d, V, 3, TODAY);
  assert.deepEqual(mo.map(x => x.ym), ["2026-08", "2026-09", "2026-10"]);
  assert.deepEqual(mo[0], { ym: "2026-08", fuel: 0, service: 0, other: 285 });
  assert.deepEqual(mo[2], { ym: "2026-10", fuel: 5390, service: 12000, other: 0 });
  assert.equal(C.monthly(d, V, 12, "2026-01-15")[0].ym, "2025-02");
});

test("CSV: rows per entry, formula injection neutralised", () => {
  assert.equal(C.csvCell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(C.csvCell("+30"), "'+30");
  assert.equal(C.csvCell("@SUM"), "'@SUM");
  assert.equal(C.csvCell("a;b"), "\"a;b\"");
  assert.equal(C.csvCell(-12.5), "-12.5");
  assert.equal(C.csvCell(null), "");
  const V = "aaaaaa1";
  const d = m(data({
    vehicles: [veh(V, { name: "=cmd" })],
    fuel: [fill("f000001", V, "2026-09-03", 1000, 40, { c: 7210, st: "Shell" })],
    costs: [{ id: "c000001", m: 1, v: V, d: "2026-08-15", cat: "toll", c: 285 }]
  }), null);
  const rows = C.csvRows(d, { fuel: "Fuel", cost: "Cost", toll: "Toll" });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ["2026-08-15", "=cmd", "Cost", "Toll", null, null, 2.85, ""]);
  assert.deepEqual(rows[1].slice(2, 7), ["Fuel", "Shell", 1000, 40, 72.1]);
  assert.equal(C.csvCell(rows[0][1]), "'=cmd");
});

test("merge: symmetric, idempotent, canonical; tombstones and resurrection", () => {
  const V = "aaaaaa1";
  const A = data({ vehicles: [veh(V)], fuel: [fill("f000001", V, "2026-09-03", 1000, 40)],
                   settings: { m: 5, cur: "EUR" } });
  const B = data({ vehicles: [veh(V, { m: 2000, name: "Golf" })],
                   fuel: [fill("f000002", V, "2026-09-10", 1500, 35)],
                   settings: { m: 9, cur: "USD" } });
  const ab = m(A, B), ba = m(B, A);
  assert.deepEqual(ab, ba);
  assert.deepEqual(m(ab, ab), ab);
  assert.equal(JSON.stringify(m(ab, null)), JSON.stringify(ab));
  assert.equal(ab.vehicles[0].name, "Golf");
  assert.equal(ab.fuel.length, 2);
  assert.equal(ab.settings.cur, "USD");
  // equal m: the larger canonical JSON wins on both sides
  const x1 = data({ vehicles: [veh(V, { m: 3000, name: "Alpha" })] });
  const x2 = data({ vehicles: [veh(V, { m: 3000, name: "Beta" })] });
  assert.deepEqual(m(x1, x2), m(x2, x1));
  // delete an entry: tombstone ≥ m hides it; a newer edit resurrects
  const del = m(ab, data({ tombs: { f000001: NOW - 1000 } }));
  assert.equal(del.fuel.length, 1);
  const back = m(del, data({ fuel: [fill("f000001", V, "2026-09-03", 1000, 40, { m: NOW })] }));
  assert.equal(back.fuel.length, 2);
  // deleting a vehicle takes its rows with it everywhere
  const gone = m(ab, data({ tombs: { [V]: NOW } }));
  assert.equal(gone.vehicles.length, 0);
  assert.equal(gone.fuel.length, 0);
  // tombstones expire after a year (same rule on every device)
  const old = m(data({ tombs: { f000009: NOW - 400 * 86400000 } }), null);
  assert.deepEqual(old.tombs, {});
  // the same renewal done on two devices writes one cost
  const r = C.normRenewal({ id: "r000001", m: 1, v: V, kind: "ins", exp: "2026-10-20", every: 12 });
  const k = C.renewal(r);
  const dev1 = data({ vehicles: [veh(V)], renewals: [Object.assign({}, r, { m: 7000, exp: k.next })],
                      costs: [{ id: k.costId, m: 7000, v: V, d: TODAY, cat: "ins", c: 30000 }] });
  const dev2 = data({ vehicles: [veh(V)], renewals: [Object.assign({}, r, { m: 7001, exp: k.next })],
                      costs: [{ id: k.costId, m: 7001, v: V, d: TODAY, cat: "ins", c: 30000 }] });
  const both = m(dev1, dev2);
  assert.equal(both.costs.length, 1);
  assert.equal(both.renewals[0].exp, "2027-10-20");
});

test("merge: hostile input never throws and never passes junk", () => {
  const junk = [null, 1, "x", [], { vehicles: "no" }, { vehicles: [null, { id: "<img>", m: 1, name: "x", type: "car" }] },
                { fuel: [{ id: "f000001", m: 1, v: "nope!", d: TODAY, km: 1, q: 1 }] }, { tombs: { "<x>": 1, ok0000: "1" } },
                { settings: { m: -1, cur: "BTC" } }, { __proto__: { vehicles: [veh("aaaaaa1")] } }];
  junk.forEach(j => {
    const out = m(j, j);
    assert.equal(out.ver, 1);
    assert.deepEqual(out.vehicles, []);
    assert.deepEqual(out.tombs, {});
    assert.equal(out.settings.cur, "EUR");
  });
  // rows whose vehicle is unknown drop
  const orphan = m(data({ fuel: [fill("f000001", "zzzzzz1", TODAY, 10, 10)] }), null);
  assert.equal(orphan.fuel.length, 0);
});

test("prefs: defaults and bounds", () => {
  assert.deepEqual(C.readPrefs(null), { remind: 9, unit: "l100", tyreAge: 6, tyreTread: 30 });
  assert.deepEqual(C.readPrefs({ remind: -1, unit: "kmpl", tyreAge: 99, tyreTread: 2 }),
                   { remind: -1, unit: "kmpl", tyreAge: 6, tyreTread: 30 });
});

test("item names: both languages for every item", () => {
  C.ITEM_IDS.forEach(it => {
    assert.ok(C.itemName(it, "en") && C.itemName(it, "el"), it);
    assert.notEqual(C.itemName(it, "en"), it);
  });
  assert.equal(C.itemName("oil", "el"), "Λάδια");
});

test("alert lines for the grouped reminder, both languages", () => {
  const V = "aaaaaa1";
  const d = m(data({
    vehicles: [veh(V, { name: "Golf" })],
    renewals: [{ id: "r000001", m: 1, v: V, kind: "ins", exp: "2026-10-14" },
               { id: "r000002", m: 1, v: V, kind: "other", label: "Parking card", exp: "2026-10-07" }],
    plans: [{ id: "p000001", m: 1, v: V, item: "oil", km: 10000, mo: 0, sd: "2026-01-01", skm: 10000 }],
    odo: [{ id: "o000001", m: 1, v: V, d: TODAY, km: 20300 }]
  }), null);
  const lines = C.alerts(d, TODAY, {}).map(a => C.alertLine(a, d, "en"));
  assert.deepEqual(lines.sort(), ["Golf: Insurance, in 5 days", "Golf: Oil change, 300 km over", "Golf: Parking card, expired 2 days ago"]);
  const el = C.alerts(d, TODAY, {}).map(a => C.alertLine(a, d, "el")).sort();
  assert.ok(el.includes("Golf: Ασφάλεια, σε 5 μέρες"));
  assert.ok(el.includes("Golf: Λάδια, πέρασαν 300 km"));
  C.RENEWAL_IDS.forEach(k => assert.ok(C.renewalName(k, "el") && C.renewalName(k, "en")));
});

test("receipts: names only, strict, unique, capped; key absent when none", () => {
  const n = C.receiptName("2026-10-09", "abc123def", "Q9k2-pz");
  assert.equal(n, "20261009-abc123def-q9k2pz.jpg");
  assert.equal(C.receiptName("2026-13-01", "abc123def", "q9k2pz"), null);
  assert.equal(C.receiptName("2026-10-09", "BAD", "q9k2pz"), null);
  assert.equal(C.receiptName("2026-10-09", "abc123def", "x"), null);
  assert.equal(C.receiptPath(n), "/internal/Garage/Receipts/" + n);
  for (const bad of ["../x.jpg", "20261009-abc123def-q9k2pz.png", "/internal/a.jpg", "20261009-abc123def-q9k2pz.jpg/..", 7, null]) {
    assert.equal(C.receiptPath(bad), null);
  }
  const many = Array.from({ length: 9 }, (_, i) => "20261009-abc123def-aaaa" + i + ".jpg");
  const row = { id: "abc123def", m: 1, v: "veh123", d: "2026-10-09", km: 100, q: 1000,
    rc: ["../../etc.jpg", many[3], many[3], ...many] };
  const f = C.normFuel(row);
  assert.equal(f.rc.length, C.MAX_RC);
  assert.deepEqual(f.rc, many.slice(0, C.MAX_RC));
  // no rc key without receipts: existing rows keep their canonical form
  assert.equal("rc" in C.normFuel({ ...row, rc: [] }), false);
  assert.equal("rc" in C.normFuel({ ...row, rc: ["junk"] }), false);
  const s = C.normService({ id: "svc123", m: 1, v: "veh123", d: "2026-10-09", items: ["oil"], rc: [many[0]] });
  const c = C.normCost({ id: "cst123", m: 1, v: "veh123", d: "2026-10-09", cat: C.COST_CATS[0], c: 500, rc: [many[1]] });
  assert.deepEqual(s.rc, [many[0]]);
  assert.deepEqual(c.rc, [many[1]]);
  // merge keeps them (row LWW) and receiptsOf lists every name in use
  const veh = { id: "veh123", m: 1, name: "Golf", type: "car" };
  const d = C.merge({ vehicles: [veh], fuel: [f], service: [s], costs: [c] }, null, NOW);
  assert.deepEqual(C.receiptsOf(d).sort(), [...many.slice(0, C.MAX_RC), many[0], many[1]].sort());
  // a newer edit that removed the photos wins
  const f2 = { ...f, m: 2 }; delete f2.rc;
  const d2 = C.merge(d, { vehicles: [veh], fuel: [f2] }, NOW);
  assert.equal("rc" in d2.fuel[0], false);
});
