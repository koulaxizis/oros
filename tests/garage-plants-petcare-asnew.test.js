// Assistant "asNew" prefills (BR-W8-6: prefill, not data) of Garage,
// Plant Care and the Pet Health Book: the pure normalisers in each
// core.js that clean what the shell hands over before the app opens
// its own new-item editor. Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const G = require(path.join(__dirname, "..", "garage/core.js"));
const P = require(path.join(__dirname, "..", "plants/core.js"));
const H = require(path.join(__dirname, "..", "petcare/core.js"));

const TODAY = "2026-10-14";

test("garage asNew: service row, items from the title, clamps", () => {
  const a = G.asNewPrefill({ vehicle: " Golf ", date: "2026-10-01", title: "Oil change", km: 123456.4,
    cost: "89.5", note: "ok\u0007", shop: "Joe's", evil: "<x>" }, TODAY);
  assert.deepEqual(a, { type: "service", vehicle: "Golf", c: 8950, n: "ok", d: "2026-10-01", km: 123456,
    items: ["oil"], shop: "Joe's" });
  const b = G.asNewPrefill({ title: "Brakes and new wipers please", date: "2026-12-01", km: -5, cost: 1e9 }, TODAY);
  assert.equal(b.d, "");                      // future service date dropped
  assert.equal(b.km, null);
  assert.equal(b.c, 0);
  assert.deepEqual(b.items, ["brakes"]);      // the longest item name found in the title (first on a tie)
  assert.equal(b.n, "Brakes and new wipers please");
  assert.deepEqual(G.asNewPrefill({ items: ["oil", "nope", "oil", "brakes"] }, TODAY).items, ["oil", "brakes"]);
  assert.equal(G.asNewPrefill({ vehicle: "Golf" }, TODAY), null);
  assert.equal(G.asNewPrefill(null, TODAY), null);
  assert.equal(G.asNewPrefill({ date: "2026-02-30" }, TODAY), null);
});

test("garage asNew: reminder (renewal) by due date, kind from the title", () => {
  const a = G.asNewPrefill({ due: "2027-03-01", title: "Insurance", cost: 320 }, TODAY);
  assert.deepEqual(a, { type: "reminder", vehicle: "", c: 32000, n: "", kind: "ins", label: "", exp: "2027-03-01" });
  const b = G.asNewPrefill({ type: "reminder", title: "Winter tyres swap", date: "2026-11-15" }, TODAY);
  assert.equal(b.kind, "other");
  assert.equal(b.label, "Winter tyres swap");
  assert.equal(b.exp, "2026-11-15");
  assert.equal(G.asNewPrefill({ type: "reminder", kind: "tax" }, TODAY).kind, "tax");
});

test("garage matchVehicle: one name or plate match, else null", () => {
  const vs = [{ name: "Golf", plate: "ΙΚΧ-1234" }, { name: "Vespa", plate: "" }, { name: "golf ", plate: "" }];
  assert.equal(G.matchVehicle(vs, "VESPA").name, "Vespa");
  assert.equal(G.matchVehicle(vs, "ικχ 1234").name, "Golf");
  assert.equal(G.matchVehicle(vs, "golf"), null);           // two match
  assert.equal(G.matchVehicle(vs, ""), null);
});

test("plants asNew: name required, species → preset or scientific name", () => {
  assert.deepEqual(P.asNewPrefill({ name: " Kitchen basil ", species: "basil", room: "Kitchen", waterDays: 3, note: "sunny" }),
    { name: "Kitchen basil", sp: "basil", sci: "", room: "Kitchen", w: 3, notes: "sunny" });
  assert.equal(P.asNewPrefill({ name: "X", species: "Βασιλικός" }).sp, "basil");
  const b = P.asNewPrefill({ name: "Y", species: "Ficus lyrata", location: "Hall", waterDays: 999 });
  assert.equal(b.sp, "");
  assert.equal(b.sci, "Ficus lyrata");
  assert.equal(b.room, "Hall");
  assert.equal(b.w, null);
  assert.equal(P.asNewPrefill({ name: "Z", waterDays: "7" }).w, 7);
  assert.equal(P.asNewPrefill({ name: "Z", waterDays: NaN }).w, null);
  assert.equal(P.asNewPrefill({ name: "x".repeat(99) }).name.length, P.NAME_LEN);
  assert.equal(P.asNewPrefill({ species: "basil" }), null);
  assert.equal(P.asNewPrefill({ name: "\u0001 " }), null);
});

test("petcare asNew: kind, record fields, nextDue after the date", () => {
  assert.deepEqual(H.asNewPrefill({ pet: "Rex", type: "Vaccine", date: "2026-10-10", title: "Rabies",
    nextDue: "2027-10-10", note: "left leg", vet: "Dr K", cost: 50 }, TODAY),
    { pet: "Rex", kind: "vacc", pre: { d: "2026-10-10", n: "Rabies", nt: "left leg", nx: "2027-10-10", v: "Dr K" } });
  assert.equal(H.asNewPrefill({ type: "visit", date: "2026-10-10", nextDue: "2026-10-01" }, TODAY).pre.nx, undefined);
  assert.deepEqual(H.asNewPrefill({ type: "visit", cost: 42.5 }, TODAY).pre, { c: 4250 });
  assert.deepEqual(H.asNewPrefill({ type: "weight", weightKg: 12.345, title: "ignored" }, TODAY),
    { pet: "", kind: "weight", pre: { g: 12345 } });
  assert.deepEqual(H.asNewPrefill({ type: "medicine", title: "Antibiotic", dose: "1 tab", until: "2026-10-20" }, TODAY).pre,
    { n: "Antibiotic", ds: "1 tab", u: "2026-10-20" });
  assert.equal(H.asNewPrefill({ type: "grooming", title: "x" }, TODAY).kind, "visit");
  assert.equal(H.asNewPrefill({ pet: "Rex", type: "vacc" }, TODAY), null);
  assert.equal(H.asNewPrefill({ type: "weight", weightKg: -1 }, TODAY), null);
});

test("petcare matchPet: exactly one name match", () => {
  const ps = [{ name: "Rex" }, { name: "Mia" }, { name: "mia" }];
  assert.equal(H.matchPet(ps, " rex ").name, "Rex");
  assert.equal(H.matchPet(ps, "Mia"), null);
  assert.equal(H.matchPet(ps, "Bo"), null);
});
