// Garage "Import from another app" (garage/import.js): Fuelio sectioned
// backup, Drivvo (sections, ";" and decimal commas), Fuelly (US units,
// several cars, trip-only rows), aCar, LubeLogger (gas units from the
// FuelEconomy column, service file), ZIP, unit conversion, dedupe
// against existing entries, stable ids (a second import adds nothing).
// Fixtures: tests/fixtures/garage/
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const I = require(path.join(__dirname, "..", "garage/import.js"));
const C = require(path.join(__dirname, "..", "garage/core.js"));
const Z = require(path.join(__dirname, "..", "atelier/zip.js"));
const FX = path.join(__dirname, "fixtures", "garage");
const fx = (n) => fs.readFileSync(path.join(FX, n), "utf8");
const empty = () => C.merge(null, null);

// write the plan into data as the app does (m = now), canonical
function apply(data, pl, now) {
  const d = JSON.parse(JSON.stringify(data));
  if (pl.vehicle && !d.vehicles.some((v) => v.id === pl.vid)) d.vehicles.push(Object.assign({}, pl.vehicle, { m: now }));
  ["fuel", "service", "costs"].forEach((k) => pl[k].forEach((r) => d[k].push(Object.assign({}, r, { m: now }))));
  return C.merge(d, d, now);
}

test("Fuelio: vehicle, fills (full / partial / missed), costs by category", () => {
  const r = I.parseText(fx("fuelio-vehicle-1-sync.csv"), "vehicle-1-sync.csv");
  assert.equal(r.source, "fuelio");
  assert.deepEqual(r.units, { dist: "km", vol: "l", sure: true });
  assert.equal(r.vehicles.length, 1);
  const v = r.vehicles[0];
  assert.equal(v.name, "My Golf");
  assert.equal(v.make, "Volkswagen");
  assert.equal(v.year, 2016);
  assert.equal(v.plate, "ΙΚΧ-1234");
  assert.equal(v.fuel, "diesel");
  assert.equal(r.skipped.income, 1);            // isIncome row; the template row is ignored
  const pl = I.plan(r, empty(), { vk: v.key, dist: "km", vol: "l" });
  assert.ok(pl.vehicle && pl.vehicle.name === "My Golf" && pl.vehicle.tank === 50);
  assert.equal(pl.fuel.length, 4);
  assert.equal(pl.stats.skipped.twice, 1);      // the repeated row of the same file
  assert.equal(pl.stats.dup, 0);
  const f0 = pl.fuel.find((x) => x.d === "2026-01-05");
  assert.equal(f0.km, 120000);
  assert.equal(f0.q, 40500);
  assert.equal(f0.c, 6237);
  assert.equal(f0.st, "Athens");
  assert.equal(f0.n, "First <b>fill</b>");      // plain text: the app shows it with textContent
  assert.equal(pl.fuel.find((x) => x.d === "2026-02-02").full, 0);
  const missed = pl.fuel.find((x) => x.d === "2026-02-14");
  assert.equal(missed.mis, 1);
  assert.equal(missed.c, 5499);                 // no total: VolumePrice × litres
  assert.equal(pl.service.length, 1);
  assert.deepEqual(pl.service[0].items, ["ofilter", "oil"].sort((a, b) => C.ITEM_IDS.indexOf(a) - C.ITEM_IDS.indexOf(b)));
  assert.equal(pl.service[0].c, 12000);
  assert.deepEqual(pl.costs.map((x) => x.cat).sort(), ["ins", "toll"]);
  assert.equal(pl.costs.find((x) => x.cat === "ins").km, null);   // Odo 0 = not given
  pl.fuel.concat(pl.service, pl.costs).forEach((x) => assert.match(x.id, C.ID_RE));
  assert.match(pl.vid, C.ID_RE);
});

test("stable ids: a second import of the same file adds nothing, into the same vehicle", () => {
  const r = I.parseText(fx("fuelio-vehicle-1-sync.csv"), "x.csv");
  const vk = r.vehicles[0].key;
  const pl = I.plan(r, empty(), { vk, dist: "km", vol: "l" });
  const d1 = apply(empty(), pl, 1700000000000);
  assert.equal(I.guessVehicle(r, vk, d1), pl.vid);
  const again = I.plan(r, d1, { vk, vid: "", dist: "km", vol: "l" });
  assert.equal(again.vid, pl.vid);
  assert.equal(again.vehicle, null);
  assert.equal(again.fuel.length + again.service.length + again.costs.length, 0);
  assert.equal(again.stats.dup, 8);           // 7 rows + the repeat, both already there
});

test("dedupe against the person's own entries (date + odometer + amount); their rows untouched", () => {
  const r = I.parseText(fx("fuelio-vehicle-1-sync.csv"), "x.csv");
  const base = C.merge({
    vehicles: [{ id: "mycar1", m: 5, name: "Golf", type: "car", fuel: "diesel" }],
    fuel: [{ id: "myfill1", m: 5, v: "mycar1", d: "2026-01-20", km: 120650, q: 42010, c: 6510, full: 1 }],
    service: [{ id: "mysvc1", m: 5, v: "mycar1", d: "2026-01-10", km: 120200, items: ["oil"], c: 12000 }],
    costs: [{ id: "mytoll", m: 5, v: "mycar1", d: "2026-01-16", cat: "toll", c: 280, km: 120400 }]
  }, null);
  const pl = I.plan(r, base, { vk: r.vehicles[0].key, vid: "mycar1", dist: "km", vol: "l" });
  assert.equal(pl.vehicle, null);
  assert.equal(pl.vid, "mycar1");
  assert.equal(pl.fuel.length, 3);
  assert.equal(pl.service.length, 0);
  assert.equal(pl.costs.length, 1);
  assert.equal(pl.stats.dup, 3);
  assert.equal(pl.stats.skipped.twice, 1);
  const d = apply(base, pl, 1700000000000);
  assert.deepEqual(d.fuel.find((x) => x.id === "myfill1"), base.fuel[0]);
  assert.equal(d.fuel.length, 4);
});

test("Drivvo: sections, ';' and decimal commas, D/M/Y, fuel type column, income skipped", () => {
  const r = I.parseText(fx("drivvo.csv"), "drivvo.csv");
  assert.equal(r.source, "drivvo");
  assert.equal(r.vehicles[0].fuel, "diesel");
  assert.equal(r.skipped.income, 1);
  assert.equal(r.units.sure, false);
  const pl = I.plan(r, empty(), { dist: "km", vol: "l", lang: "el" });
  assert.equal(pl.vehicle.name, "Εισαγόμενο όχημα");
  assert.equal(pl.vehicle.fuel, "diesel");
  assert.equal(pl.fuel.length, 2);
  const f = pl.fuel.find((x) => x.d === "2026-03-05");
  assert.equal(f.q, 40000);                     // 66,36 / 1,659
  assert.equal(f.c, 6636);
  assert.equal(f.full, 1);
  assert.equal(pl.fuel.find((x) => x.d === "2026-03-20").full, 0);
  assert.deepEqual(pl.service.map((x) => x.items), [["timing"]]);
  assert.equal(pl.service[0].shop, "Garage Nikos");
  assert.deepEqual(pl.stats.cats, { park: 1, toll: 1 });
});

test("Fuelly: US units converted, several cars, trip-only odometer, price per gallon", () => {
  const r = I.parseText(fx("fuelly.csv"), "fuelly.csv");
  assert.equal(r.source, "fuelly");
  assert.deepEqual(r.units, { dist: "mi", vol: "usgal", sure: false });
  assert.deepEqual(r.vehicles.map((v) => v.name), ["Civic", "Truck"]);
  const pl = I.plan(r, empty(), { vk: "Civic", dist: "mi", vol: "usgal" });
  assert.equal(pl.fuel.length, 3);
  const a = pl.fuel.find((x) => x.d === "2026-03-01");
  assert.equal(a.km, 16093);                    // 10 000 mi
  assert.equal(a.q, 37854);                     // 10 US gal
  assert.equal(a.c, 3500);                      // 10 × 3.50
  const trip = pl.fuel.find((x) => x.d === "2026-03-15");
  assert.equal(trip.km, Math.round(10450 * 1.609344));   // 10 300 + 150 mi trip
  assert.equal(trip.full, 0);
  // UK gallons when picked
  const uk = I.plan(r, empty(), { vk: "Civic", dist: "mi", vol: "ukgal" });
  assert.equal(uk.fuel.find((x) => x.d === "2026-03-01").q, 45461);
  const tr = I.plan(r, empty(), { vk: "Truck", dist: "mi", vol: "usgal" });
  assert.equal(tr.vehicle.name, "Truck");
  assert.notEqual(tr.vid, pl.vid);
  assert.equal(tr.fuel.length, 1);
  assert.equal(tr.fuel[0].mis, 1);
});

test("aCar fill-ups", () => {
  const r = I.parseText(fx("acar.csv"), "acar.csv");
  assert.equal(r.source, "acar");
  assert.equal(r.vehicles[0].name, "Outback");
  const pl = I.plan(r, empty(), { dist: "km", vol: "l" });
  assert.equal(pl.fuel.length, 2);
  assert.equal(pl.fuel[0].st, "Costco");
});

test("LubeLogger: gas units guessed from FuelEconomy, service file → items", () => {
  const g = I.parseText(fx("lubelogger-gas.csv"), "GasRecords.csv");
  assert.equal(g.source, "lubelogger");
  assert.equal(g.units.dist, "mi");
  assert.equal(g.units.vol, "usgal");
  const pl = I.plan(g, empty(), { dist: "mi", vol: "usgal" });
  assert.equal(pl.stats.full, 2);
  assert.equal(pl.stats.partial, 1);
  assert.equal(pl.fuel[0].n === "" || typeof pl.fuel[0].n === "string", true);
  const s = I.parseText(fx("lubelogger-servicerecords.csv"), "ServiceRecords.csv");
  assert.equal(s.source, "lubelogger");
  const d1 = apply(empty(), pl, 1700000000000);
  const ps = I.plan(s, d1, { vid: pl.vid, dist: "mi", vol: "l" });
  assert.equal(ps.vehicle, null);
  assert.deepEqual(ps.service.map((x) => x.items), [["oil", "afilter"], ["brakes"]]);
  assert.equal(ps.service[0].km, Math.round(20010 * 1.609344));
  // a metric LubeLogger file (l/100km economy) reads as km / litres
  const metric = "Date,Odometer,FuelConsumed,Cost,FuelEconomy,IsFillToFull,MissedFuelUp,Notes,Tags\n" +
    "2026-04-01,20000,40,70,0,True,False,,\n2026-04-15,20600,42,72,7.00,True,False,,\n";
  assert.deepEqual(I.parseText(metric, "gas.csv").units, { dist: "km", vol: "l", sure: false });
  // the kind of a LubeLogger record file comes from its name
  const up = I.parseText("Date,Odometer,Description,Cost,Notes,Tags\n2026-05-01,21000,Roof rack,150,,\n", "UpgradeRecords.csv");
  assert.deepEqual(I.plan(up, empty(), {}).costs.map((x) => x.cat), ["acc"]);
});

test("ZIP of several Fuelio vehicles", async () => {
  const zip = Z.write([
    { name: "vehicle-1-sync.csv", data: Buffer.from(fx("fuelio-vehicle-1-sync.csv")) },
    { name: "vehicle-2-sync.csv", data: Buffer.from(fx("fuelio-vehicle-1-sync.csv").replace(/My Golf/g, "Vespa")) }
  ]);
  const r = await I.readBytes(new Uint8Array(zip), "fuelio.zip");
  assert.equal(r.source, "fuelio");
  assert.deepEqual(r.vehicles.map((v) => v.name), ["My Golf", "Vespa"]);
  const pl = I.plan(r, empty(), { vk: r.vehicles[1].key, dist: "km", vol: "l" });
  assert.equal(pl.vehicle.name, "Vespa");
  assert.equal(pl.fuel.length, 4);
});

test("bad, empty and odd input; words → categories", () => {
  assert.equal(I.parseText("", "x").error, "empty");
  assert.equal(I.parseText("{\"a\":1}", "x.json").error, "bad");
  assert.equal(I.parseText("foo,bar\n1,2\n", "x.csv").error, "bad");
  assert.equal(I.parseText("Date,Odometer,Volume\n", "x.csv").error, "empty");
  // a row without odometer is skipped, not guessed
  const r = I.parseText("Date,Odometer,Volume,Total cost\n2026-01-01,,30,50\n2026-01-09,1200,30,50\n", "x.csv");
  const pl = I.plan(r, empty(), {});
  assert.equal(pl.fuel.length, 1);
  assert.equal(pl.stats.skipped.noKm, 1);
  // a bicycle takes no fuel
  const bike = C.merge({ vehicles: [{ id: "bike01", m: 1, name: "Bike", type: "bike", fuel: "none" }] }, null);
  assert.equal(I.plan(r, bike, { vid: "bike01" }).stats.skipped.noFuel, 2);
  assert.equal(I.catOf("Διόδια Αττικής Οδού"), "toll");
  assert.equal(I.catOf("Parking garage"), "park");
  assert.equal(I.catOf("Something"), "other");
  assert.deepEqual(I.itemsOf("Αλλαγή λάδια και φίλτρο αέρα"), ["oil", "afilter"]);
  assert.deepEqual(I.itemsOf("Fixed the radio"), ["other"]);
  assert.equal(I.fuelOf("Diesel"), "diesel");
  assert.equal(I.fuelOf("400"), "lpg");
});
