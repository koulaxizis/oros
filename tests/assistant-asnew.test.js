// Assistant phase 4 wave 1 (BR-AS-NEW): the new propose_entry kinds
// become { asNew } payloads, and every card the Assistant shows is one
// the receiving app's own normaliser accepts with the same values.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const root = path.join(__dirname, "..");
const A = require(path.join(root, "assistant/core.js"));
const CT = require(path.join(root, "contacts/cardtext.js"));
const CRM = require(path.join(root, "crm/core.js"));
const KB = require(path.join(root, "kanban/tools.js"));
const HB = require(path.join(root, "habits/model.js"));
const GA = require(path.join(root, "garage/core.js"));
const PL = require(path.join(root, "plants/core.js"));
const PC = require(path.join(root, "petcare/core.js"));

const o = { from: "Assistant" };
function payload(args) {
  const e = A.normEntry(args, o);
  assert.equal(e.ok, true, JSON.stringify(args) + " → " + e.err);
  assert.equal(e.call.fn, "openAt");
  assert.equal(e.call.args[0], A.ENTRY_KINDS[args.kind]);
  return e.call.args[1].asNew;
}

test("asNew kinds: every new kind maps to its app and offers a card", () => {
  ["contact", "customer", "card", "habit", "workout", "car", "plant", "pet_record", "media", "place", "shared_expense"]
    .forEach((k) => assert.ok(A.entryKinds().indexOf(k) >= 0, k));
  const tools = A.toolsFor({ entries: true });
  const entry = tools.find((t) => t.name === "propose_entry");
  assert.ok(entry.params.properties.kind.enum.indexOf("shared_expense") >= 0);
});

test("asNew: contact and customer round-trip into Contacts and CRM", () => {
  const c = payload({ kind: "contact", name: "Maria Papadopoulou", org: "ACME", phones: ["+30 210 1234567", "nope"],
    emails: ["maria@example.com", "bad"], birthday: "--03-21", note: "Met at the fair" });
  assert.deepEqual(c, { name: "Maria Papadopoulou", org: "ACME", phones: ["+30 210 1234567"], emails: ["maria@example.com"],
    birthday: "03-21", note: "Met at the fair", from: "Assistant" });
  const ct = CT.fromAsNew(c);
  assert.ok(ct, "Contacts accepts it");
  const cu = payload({ kind: "customer", company: "ACME AE", name: "Nikos", email: "n@acme.gr", vat: "el 123 456 789" });
  assert.equal(cu.vat, "EL123456789");
  assert.ok(CRM.asNewCust(cu), "CRM accepts it");
});

test("asNew: card, habit, car, plant, pet record round-trip into their apps", () => {
  const k = payload({ kind: "card", title: "Call the printer", board: "Work", column: "To do", due: "2026-10-20", note: "Ask for proofs" });
  assert.deepEqual(KB.asNew(k), { board: "Work", column: "To do", title: "Call the printer", notes: "Ask for proofs", due: "2026-10-20" });
  const h = payload({ kind: "habit", title: "Drink water", target: 8, unit: "glasses", days: [0, 2, 9, 2], reminder: "9:00" });
  assert.deepEqual(h.days, [0, 2]);
  assert.equal(h.reminder, "09:00");
  const hn = HB.asNew(h);
  assert.ok(hn && hn.name === "Drink water", "Habits accepts it");
  const g = payload({ kind: "car", vehicle: "Golf", type: "reminder", due: "2027-03-01", title: "KTEO" });
  assert.ok(GA.asNewPrefill(g, "2026-10-14"), "Garage accepts it");
  const p = payload({ kind: "plant", title: "Monstera", room: "Living room", water_days: 7 });
  assert.ok(PL.asNewPrefill(p), "Plants accepts it");
  const v = payload({ kind: "pet_record", pet: "Mia", record: "vaccine", date: "2026-10-01", next_due: "2027-10-01", title: "Rabies" });
  assert.equal(v.type, "vacc");
  assert.ok(PC.asNewPrefill(v, "2026-10-14"), "Pet Health Book accepts it");
});

test("asNew: workout, media, place, shared expense payloads", () => {
  assert.deepEqual(payload({ kind: "workout", activity: "Running", minutes: 31.6, distance_km: 5.004, date: "2026-10-13" }),
    { type: "Running", minutes: 32, distanceKm: 5, date: "2026-10-13", from: "Assistant" });
  assert.deepEqual(payload({ kind: "media", title: "Dune", media: "book", status: "dropped", by: "Frank Herbert", year: 1965 }),
    { title: "Dune", kind: "book", status: "drop", by: "Frank Herbert", year: 1965, from: "Assistant" });
  assert.deepEqual(payload({ kind: "place", title: "Acropolis Museum", lat: 37.968447, lon: 23.728552 }),
    { name: "Acropolis Museum", lat: 37.968447, lon: 23.728552, from: "Assistant" });
  assert.equal(payload({ kind: "place", title: "Acropolis Museum", lat: 99, lon: 1 }).query, "Acropolis Museum");
  assert.deepEqual(payload({ kind: "shared_expense", group: "Crete trip", title: "Dinner", amount: "64.255", paid_by: "Bob", currency: "EUR" }),
    { group: "Crete trip", title: "Dinner", amount: 64.26, paid_by: "Bob", currency: "EUR", from: "Assistant" });
});

test("asNew: anything the receiver would reject never becomes a card", () => {
  const bad = [
    { kind: "contact" }, { kind: "contact", name: "X", birthday: "1990-02-30" },
    { kind: "customer", email: "a@b.c" }, { kind: "customer", name: "X", email: "nope" },
    { kind: "card" }, { kind: "card", title: "x", due: "soon" },
    { kind: "habit" }, { kind: "habit", title: "x", reminder: "25:00" },
    { kind: "workout" }, { kind: "workout", activity: "Run", start: "7" },
    { kind: "car" }, { kind: "car", type: "service", title: "Oil", date: "2999-01-01" },
    { kind: "plant" }, { kind: "pet_record", record: "weight" },
    { kind: "pet_record", date: "2026-10-10", next_due: "2026-10-01" },
    { kind: "media" }, { kind: "place" }, { kind: "shared_expense" },
    { kind: "shared_expense", title: "x", amount: -3 }, { kind: "shared_expense", title: "x", currency: "eur" }
  ];
  bad.forEach((b) => assert.equal(A.normEntry(b, {}).ok, false, JSON.stringify(b)));
  // Text stays text: HTML in a name reaches the card as it is (shown via textContent).
  const e = A.normEntry({ kind: "plant", title: "<img src=x onerror=alert(1)>" }, {});
  assert.equal(e.view.title, "<img src=x onerror=alert(1)>");
});
