// Garage wave 34: the fuel receipt reader (garage/receipt.js) and
// the printable logbook (garage/logbook.js). Pure logic only.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const R = require(path.join(__dirname, "..", "garage/receipt.js"));
const L = require(path.join(__dirname, "..", "garage/logbook.js"));
const C = require(path.join(__dirname, "..", "garage/core.js"));

const TODAY = "2026-10-14";

test("receipt numbers: the last separator is the decimal point", () => {
  assert.equal(R.num("1,879"), 1.879);
  assert.equal(R.num("32.15"), 32.15);
  assert.equal(R.num("1.234,56"), 1234.56);
  assert.equal(R.num("1,234.56"), 1234.56);
  assert.equal(R.num("60"), 60);
  assert.equal(R.num("1,,2"), null);
  assert.equal(R.num("12a"), null);
  assert.equal(R.num(""), null);
});

test("Greek receipt: quantity × price line, total, VAT and cash ignored", () => {
  const r = R.parse([
    "ΕΚΟ ΑΒΕΕ", "ΠΡΑΤΗΡΙΟ ΠΑΠΑΔΟΠΟΥΛΟΣ Ο.Ε.", "ΑΦΜ 123456789 ΔΟΥ ΚΑΛΑΜΑΡΙΑΣ",
    "ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚΗΣ ΠΩΛΗΣΗΣ", "14/10/2026 08:32", "ΑΜΟΛΥΒΔΗ 95", "ΑΝΤΛΙΑ 3",
    "32,15 LT X 1,879", "ΣΥΝΟΛΟ 60,41", "ΦΠΑ 24% 11,69", "ΜΕΤΡΗΤΑ 70,00", "ΡΕΣΤΑ 9,59"
  ].join("\n"), TODAY);
  assert.equal(r.q, 32.15);
  assert.equal(r.p, 1.879);
  assert.equal(r.c, 6041);
  assert.equal(r.d, "2026-10-14");
  assert.equal(r.st, "EKO");
  assert.deepEqual(r.found.sort(), ["c", "d", "p", "q", "st"]);
});

test("Greek receipt with labels and accents, ISO date, no brand", () => {
  const r = R.parse("Πρατήριο Καυσίμων Νικολάου\nΑμόλυβδη 95\nΠοσότητα: 25,000 λίτρα\nΤιμή μον.: 1,899 €/λίτρο\nΑξία: 47,48 €\nΗμ/νία 2026-10-01", TODAY);
  assert.equal(r.q, 25);
  assert.equal(r.p, 1.899);
  assert.equal(r.c, 4748);
  assert.equal(r.d, "2026-10-01");
  assert.equal(r.st, "Πρατήριο Καυσίμων Νικολάου");
});

test("English receipt: Price/L, TOTAL, VAT line skipped, day/month date", () => {
  const r = R.parse("Shell Wembley\nPump 4  Unleaded\nVolume 41.27 L\nPrice/L £1.459\nTOTAL £60.21\nVAT @ 20% £10.04\nDate: 03/09/2026 17:45", TODAY);
  assert.equal(r.q, 41.27);
  assert.equal(r.p, 1.459);
  assert.equal(r.c, 6021);
  assert.equal(r.d, "2026-09-03");
  assert.equal(r.st, "Shell");
});

test("charging receipt: kWh marks electricity", () => {
  const r = R.parse("IONITY Charging\nEnergy 38.5 kWh\n0.59 EUR/kWh\nTotal EUR 22.72\n12.10.2026", TODAY);
  assert.equal(r.q, 38.5);
  assert.equal(r.e, "e");
  assert.equal(r.p, 0.59);
  assert.equal(r.c, 2272);
  assert.equal(r.d, "2026-10-12");
});

test("two of three give the third; disagreeing price follows quantity and total", () => {
  const a = R.parse("Litres 40.00 L\nTOTAL 72.00", TODAY);
  assert.equal(a.q, 40);
  assert.equal(a.c, 7200);
  assert.equal(a.p, 1.8);
  assert.ok(a.found.indexOf("p") < 0);
  const b = R.parse("20,00 L X 1,500\n", TODAY);
  assert.equal(b.c, 3000);
  const c = R.parse("20,00 L X 1,500\nΣΥΝΟΛΟ 31,00", TODAY);
  assert.equal(c.p, 1.55);
});

test("dates: future and impossible dates refused, US order as a fallback", () => {
  assert.equal(R.parse("31/02/2026\n10 L X 1,8", TODAY).d, undefined);
  assert.equal(R.parse("20/12/2026\n10 L X 1,8", TODAY).d, undefined);
  assert.equal(R.parse("10/25/2026", "2026-12-31").d, "2026-10-25");
  assert.equal(R.parse("05.10.26", TODAY).d, "2026-10-05");
});

test("nothing to find: only text, never a crash on junk", () => {
  const r = R.parse("Thank you for your visit", TODAY);
  assert.equal(r.q, undefined);
  assert.equal(r.c, undefined);
  assert.equal(r.p, undefined);
  assert.deepEqual(R.parse("", TODAY).found, []);
  assert.deepEqual(R.parse(null, TODAY).found, []);
  R.parse("<script>alert(1)</script>\n".repeat(500), TODAY);
});

// ---------- logbook ----------
function sample() {
  const raw = {
    vehicles: [{ id: "veh0001", m: 1, name: "Golf <b>", type: "car", fuel: "petrol", make: "VW", model: "Golf", year: 2015, plate: "ΙΚΧ-1234" },
               { id: "veh0002", m: 1, name: "Other", type: "car", fuel: "diesel" }],
    fuel: [
      { id: "fuel001", m: 1, v: "veh0001", d: "2026-01-10", km: 100000, q: 40000, c: 7200, full: 1, st: "EKO" },
      { id: "fuel002", m: 1, v: "veh0001", d: "2026-02-10", km: 100600, q: 36000, c: 6480, full: 1, st: "Shell" },
      { id: "fuel003", m: 1, v: "veh0002", d: "2026-02-10", km: 5000, q: 10000, c: 1800, full: 1 }
    ],
    service: [
      { id: "serv001", m: 1, v: "veh0001", d: "2026-03-01", km: 101000, items: ["oil", "ofilter"], c: 12000, shop: "Garage & Sons", n: "<img src=x onerror=alert(1)>" },
      { id: "serv002", m: 1, v: "veh0001", d: "2025-03-01", km: 90000, items: ["brakes"], c: 25000, shop: "" }
    ],
    costs: [{ id: "cost001", m: 1, v: "veh0001", d: "2026-04-01", cat: "wash", c: 1000, km: null }],
    renewals: [{ id: "renw001", m: 1, v: "veh0001", kind: "kteo", exp: "2027-05-01", every: 24, warn: [30] }],
    tyres: [{ id: "tyre001", m: 1, v: "veh0001", label: "Michelin", season: "s", on: 1, okm: 90000, dot: "0324" }],
    odo: [], plans: [], tombs: {}
  };
  return C.merge(raw, null);
}
function fmt() {
  return {
    lang: "en",
    t: (k, p) => k + (p ? JSON.stringify(p) : ""),
    money: (c) => "€" + (c / 100).toFixed(2), km: (n) => String(n), day: (d) => d,
    qty: (q) => (q / 1000).toFixed(2) + " L", per100: (v) => v.toFixed(1) + " L/100",
    item: (i) => C.itemName(i, "en"), cat: (c) => c, ren: (r) => r.kind, fuel: (f) => f,
    type: (x) => x, season: (s) => s
  };
}

test("logbook: one vehicle, services oldest first, summary, consumption", () => {
  const d = sample();
  const r = L.build(d, "veh0001", { fuel: true, costs: true, money: true, today: TODAY });
  assert.equal(r.service.length, 2);
  assert.equal(r.service[0].id, "serv002");
  assert.equal(r.fuel.length, 2);
  assert.equal(r.kmLo, 90000);
  assert.equal(r.kmHi, 101000);
  assert.equal(r.first, "2025-03-01");
  assert.equal(r.sum.service, 37000);
  assert.equal(r.sum.fuel, 13680);
  assert.equal(r.sum.other, 1000);
  assert.ok(Math.abs(r.cons.f - 6) < 1e-9);          // 36 L over 600 km
  assert.equal(L.build(d, "nope", {}), null);
});

test("logbook html: data escaped, options respected", () => {
  const d = sample();
  const f = fmt();
  const full = L.html(L.build(d, "veh0001", { fuel: true, costs: true, money: true, today: TODAY }), f);
  assert.ok(full.indexOf("<img") < 0);
  assert.ok(full.indexOf("&lt;img src=x onerror=alert(1)&gt;") >= 0);
  assert.ok(full.indexOf("Golf &lt;b&gt;") >= 0);
  assert.ok(full.indexOf("Garage &amp; Sons") >= 0);
  assert.ok(full.indexOf("€120.00") >= 0);
  assert.ok(full.indexOf("lb.fuel") >= 0 && full.indexOf("Shell") >= 0);
  assert.ok(full.indexOf("lb.costs") >= 0);
  const lean = L.html(L.build(d, "veh0001", { fuel: false, costs: false, money: false, today: TODAY }), f);
  assert.ok(lean.indexOf("€") < 0);
  assert.ok(lean.indexOf("Shell") < 0);
  assert.ok(lean.indexOf("lb.costs") < 0);
  assert.ok(lean.indexOf("Oil change") >= 0);
  const page = L.page(L.build(d, "veh0001", { money: true, today: TODAY }), f);
  assert.ok(/^<!DOCTYPE html>/.test(page));
  assert.ok(page.indexOf("<script") < 0);
  assert.equal(L.esc("<a href='x'>&\""), "&lt;a href=&#39;x&#39;&gt;&amp;&quot;");
});

test("logbook: a vehicle without entries still gives a page", () => {
  const d = C.merge({ vehicles: [{ id: "veh0003", m: 1, name: "New", type: "bike" }] }, null);
  const r = L.build(d, "veh0003", { fuel: true, money: true, today: TODAY });
  assert.equal(r.first, null);
  const h = L.html(r, fmt());
  assert.ok(h.indexOf("lb.none") >= 0);
});
