// Split "Import from another app" (split/import.js): Splitwise CSV
// (net columns, payments, Total balance rows, several payers),
// Tricount CSV / .xlsx (impacted-to shares, transfers, income),
// Settle Up CSV (weights, per-payer amounts, exchange rate), the plan
// against existing data (new group, renamed / merged people, stable ids
// so a second import adds nothing, deleted rows stay deleted, caps) and
// the balance check against the source's own totals.
// Fixtures: tests/fixtures/split-import/
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const I = require(path.join(__dirname, "..", "split/import.js"));
const X = require(path.join(__dirname, "..", "vendor/xlsx.full.min.js"));
const FX = path.join(__dirname, "fixtures", "split-import");
const fx = (n) => fs.readFileSync(path.join(FX, n), "utf8");
const NOW = 1790000000000;
const empty = () => ({ groups: [], people: [], exp: [], pay: [], mine: [], tombs: {} });

// what Split's balances would be: by − w for expenses, from − to payments
function balances(p) {
  const b = {};
  p.exp.forEach((x) => {
    Object.keys(x.by).forEach((k) => { b[k] = (b[k] || 0) + x.by[k]; });
    Object.keys(x.w).forEach((k) => { b[k] = (b[k] || 0) - x.w[k]; });
  });
  p.pay.forEach((x) => { b[x.f] = (b[x.f] || 0) + x.a; b[x.to] = (b[x.to] || 0) - x.a; });
  const out = {};
  p.members.forEach((m) => { out[m.n] = b[m.id] || 0; });
  return out;
}
// the plan applied as split.js does (one push per collection)
function apply(d, p) {
  const n = JSON.parse(JSON.stringify(d));
  if (p.group) n.groups.push(p.group);
  n.people = n.people.concat(p.people);
  n.exp = n.exp.concat(p.exp);
  n.pay = n.pay.concat(p.pay);
  return n;
}
const sum = (m) => Object.keys(m).reduce((s, k) => s + m[k], 0);
const ID = /^[a-z0-9]{1,24}(\.[a-z0-9]{1,24})?$/;

test("Splitwise: nets → payers and shares, payments, totals, other currency skipped", () => {
  const r = I.parseText(fx("splitwise.csv"), "trip-to-paris_2026-05-06_export.csv");
  assert.equal(r.source, "splitwise");
  assert.equal(r.name, "Trip to paris");
  assert.equal(r.cur, "EUR");
  assert.deepEqual(r.members, ["Anna", "Bob", "Chris"]);
  assert.equal(r.found, 8);
  assert.deepEqual(r.skipped, { even: 1, cur: 1 });
  assert.equal(r.wantFrom, "totals");
  const dinner = r.items[0];
  assert.deepEqual(dinner.by, { Anna: 9000 });
  assert.deepEqual(dinner.owe, { Anna: 3000, Bob: 3000, Chris: 3000 });
  assert.equal(dinner.c, "food");
  const hotel = r.items.find((x) => x.t === "Hotel");          // two payers
  assert.deepEqual(hotel.by, { Anna: 15000, Bob: 15000 });
  assert.deepEqual(hotel.owe, { Anna: 5000, Bob: 5000, Chris: 20000 });
  assert.equal(hotel.c, "stay");
  const pay = r.items.find((x) => x.k === "p");
  assert.deepEqual([pay.by, pay.owe, pay.a], [{ Bob: 2000 }, { Anna: 2000 }, 2000]);
  // two identical rows stay two (nth duplicate in the key)
  const g = r.items.filter((x) => x.t === "Groceries");
  assert.equal(g.length, 2);
  assert.notEqual(g[0].key, g[1].key);
  r.items.forEach((x) => { assert.equal(sum(x.by), x.a); assert.equal(sum(x.owe), x.a); });
});

test("Splitwise plan: new group, valid ids, balances equal the Total balance row", () => {
  const r = I.parseText(fx("splitwise.csv"), "trip.csv");
  const p = I.plan(r, empty(), { now: NOW, gname: "Paris <3" });
  assert.equal(p.isNew, true);
  assert.equal(p.group.n, "Paris <3");                       // plain text, shown with textContent
  assert.equal(p.group.cur, "EUR");
  assert.ok(ID.test(p.gid) && p.gid.startsWith("imp"));
  assert.deepEqual(p.add, { e: 5, p: 1 });
  assert.equal(p.people.length, 3);
  p.people.concat(p.exp, p.pay).forEach((x) => { assert.ok(ID.test(x.id), x.id); assert.ok(x.id.startsWith(p.gid + ".")); });
  p.exp.forEach((x) => { assert.equal(x.mode, "ex"); assert.equal(sum(x.by), x.a); assert.equal(sum(x.w), x.a); });
  assert.equal(p.from, "2026-05-01");
  assert.equal(p.to, "2026-05-05");
  assert.equal(p.check.ok, true);
  assert.deepEqual(balances(p), { Anna: 9966, Bob: 17066, Chris: -27032 });
});

test("balance check warns when the source's totals differ by more than 0.01", () => {
  const bad = fx("splitwise.csv").replace("99.66,170.66,-270.32", "99.70,170.62,-270.32");
  const p = I.plan(I.parseText(bad, "x.csv"), empty(), { now: NOW });
  assert.equal(p.check.ok, false);
  const diffs = p.check.diffs.map((d) => [d.n, d.want, d.got]).sort();
  assert.deepEqual(diffs, [["Anna", 9970, 9966], ["Bob", 17062, 17066]]);
  // one cent is rounding, not a warning
  const ok = fx("splitwise.csv").replace("99.66,170.66,-270.32", "99.67,170.65,-270.32");
  assert.equal(I.plan(I.parseText(ok, "x.csv"), empty(), { now: NOW }).check.ok, true);
});

test("re-import adds only what is missing; deleted rows stay deleted", () => {
  const r = I.parseText(fx("splitwise.csv"), "trip.csv");
  const p1 = I.plan(r, empty(), { now: NOW });
  let d = apply(empty(), p1);
  // the same file again → the same group, nothing new
  const p2 = I.plan(r, d, { now: NOW + 5 });
  assert.equal(p2.gid, p1.gid);
  assert.equal(p2.isNew, false);
  assert.equal(p2.group, null);
  assert.deepEqual([p2.add, p2.have, p2.people.length], [{ e: 0, p: 0 }, 6, 0]);
  assert.equal(p2.check.ok, true);
  // a later export with one more row → only that row
  const more = fx("splitwise.csv").replace("\n\n2026-05-06,Total", "\n2026-05-06,Wine,Liquor,12.00,EUR,8.00,-4.00,-4.00\n\n2026-05-06,Total");
  const p3 = I.plan(I.parseText(more, "trip (1).csv"), d, { now: NOW + 9 });
  assert.equal(p3.gid, p1.gid);
  assert.deepEqual([p3.add, p3.have], [{ e: 1, p: 0 }, 6]);
  assert.equal(p3.exp[0].t, "Wine");
  assert.equal(p3.exp[0].c, "food");
  // you deleted an imported expense (tombstone): it is not brought back
  const gone = p1.exp[0].id;
  d.exp = d.exp.filter((x) => x.id !== gone);
  d.tombs["exp:" + gone] = NOW + 20;
  const p4 = I.plan(r, d, { now: NOW + 30 });
  assert.deepEqual([p4.add, p4.have, p4.gone], [{ e: 0, p: 0 }, 5, 1]);
  // "new" makes a separate group even though the imported one exists
  const p5 = I.plan(r, d, { now: NOW + 40, target: "new" });
  assert.notEqual(p5.gid, p1.gid);
  assert.equal(p5.isNew, true);
  assert.deepEqual(p5.add, { e: 5, p: 1 });
});

test("an undone import (group tombstone) can be imported again", () => {
  const r = I.parseText(fx("splitwise.csv"), "trip.csv");
  const p1 = I.plan(r, empty(), { now: NOW });
  const d = empty();
  d.tombs["grp:" + p1.gid] = NOW + 100;
  const p2 = I.plan(r, d, { now: NOW + 50 });
  assert.equal(p2.isNew, true);
  assert.ok(p2.group.m > NOW + 100);                         // newer than the tombstone
  assert.deepEqual(p2.add, { e: 5, p: 1 });
});

test("rename and merge members in the preview; existing people are matched by name", () => {
  const r = I.parseText(fx("splitwise.csv"), "trip.csv");
  const p = I.plan(r, empty(), { now: NOW, names: { bob: "Anna", chris: "Christos" } });
  assert.equal(p.people.length, 2);
  assert.deepEqual(p.people.map((x) => x.n), ["Anna", "Christos"]);
  assert.equal(p.members[0].id, p.members[1].id);             // Bob merged into Anna
  assert.deepEqual(balances(p), { Anna: 27032, Christos: -27032 });
  // the payment Bob → Anna is now to oneself: skipped
  assert.equal(p.skipped.self, 1);
  // into an existing group: its people by name, no duplicates
  const d = empty();
  d.groups.push({ id: "abc", m: 1, n: "Trip", col: 2, cur: "EUR", arch: 0 });
  d.people.push({ id: "abc.p1", m: 1, n: "anna" }, { id: "abc.p2", m: 1, n: "Dora" });
  const q = I.plan(r, d, { now: NOW, target: "abc" });
  assert.equal(q.gid, "abc");
  assert.equal(q.isNew, false);
  assert.equal(q.members[0].id, "abc.p1");
  assert.equal(q.members[0].isNew, false);
  assert.deepEqual(q.people.map((x) => x.n), ["Bob", "Chris"]);
});

test("Tricount CSV: impacted-to shares, decimal commas, D/M/Y, transfer, income", () => {
  const r = I.parseText(fx("tricount.csv"), "tricount.csv");
  assert.equal(r.source, "tricount");
  assert.deepEqual(r.members, ["Anna", "Bob", "Chris"]);
  assert.deepEqual(r.skipped, { cur: 1 });                    // USD without a rate
  const museum = r.items.find((x) => x.t === "Museum");
  assert.equal(museum.d, "2026-05-13");
  assert.deepEqual(museum.owe, { Anna: 1250, Bob: 1250 });
  assert.equal(museum.c, "fun");
  const refund = r.items.find((x) => x.t === "Refund");
  assert.equal(refund.k, "p");
  assert.deepEqual([refund.by, refund.owe], [{ Chris: 3000 }, { Anna: 3000 }]);
  const inc = r.items.find((x) => x.t === "Deposit back");     // income: the others "paid" for Anna
  assert.deepEqual([inc.by, inc.owe], [{ Anna: 2000, Bob: 2000 }, { Anna: 4000 }]);
  const p = I.plan(r, empty(), { now: NOW });
  assert.equal(p.check.ok, true);
  assert.deepEqual(balances(p), { Anna: -250, Bob: 250, Chris: 0 });
});

test("Tricount .xlsx through SheetJS (dates as cells, converted amount → rate)", async () => {
  const aoa = [
    ["Tricount: Rome"],
    [],
    ["Title", "Amount", "Currency", "Amount in default currency", "Date", "Paid by", "Impacted to Anna", "Impacted to Bob", "Category", "Transaction type"],
    ["Pizza", 40, "EUR", 40, new Date(2026, 6, 1), "Anna", 20, 20, "Restaurants & bars", "Expense"],
    ["Gelato", 10, "CHF", 10.5, new Date(2026, 6, 2), "Bob", 5, 5, "", "Expense"],
    ["Back", 20, "EUR", 20, new Date(2026, 6, 3), "Bob", 20, 0, "", "Money transfer"]
  ];
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa, { cellDates: true }), "Expenses");
  const bytes = new Uint8Array(X.write(wb, { type: "array", bookType: "xlsx" }));
  let asked = 0;
  const r = await I.readBytes(bytes, "Tricount_Rome.xlsx", () => { asked++; return Promise.resolve(X); });
  assert.equal(asked, 1);
  assert.equal(r.source, "tricount");
  assert.equal(r.name, "Rome");
  assert.equal(r.items[0].d, "2026-07-01");
  const gel = r.items[1];
  assert.deepEqual([gel.cur, gel.rate, gel.a], ["CHF", 1.05, 1000]);
  const p = I.plan(r, empty(), { now: NOW });
  const e = p.exp.find((x) => x.t === "Gelato");
  assert.equal(e.a, 1050);
  assert.deepEqual(e.fx.c, "CHF");
  assert.equal(sum(e.w), 1050);
  assert.equal(p.pay.length, 1);
  assert.equal(p.check.ok, true);
  // a CSV never asks for the library
  await I.readBytes(Buffer.from(fx("tricount.csv")), "t.csv", () => { asked++; return Promise.resolve(X); });
  assert.equal(asked, 1);
});

test("Settle Up: weights, per-payer amounts, inline weights, exchange rate, transfer", () => {
  const r = I.parseText(fx("settleup.csv"), "Holiday_settleup.csv");
  assert.equal(r.source, "settleup");
  assert.equal(r.name, "Holiday");
  assert.equal(r.cur, "EUR");
  const groc = r.items[0];
  assert.deepEqual(groc.owe, { Anna: 2000, Bob: 2000, Chris: 2000 });
  assert.equal(groc.c, "groc");                               // 🛒
  assert.deepEqual(r.items[1].owe, { Anna: 7000, Bob: 3000 }); // exact split amounts
  const pub = r.items[2];
  assert.deepEqual([pub.cur, pub.rate], ["GBP", 1.17]);
  assert.equal(r.items[3].k, "p");
  const taxi = r.items[4];
  assert.deepEqual(taxi.by, { Anna: 1000, Bob: 2000 });
  assert.deepEqual(taxi.owe, { Anna: 1000, Chris: 2000 });    // "Chris (2);Anna"
  assert.equal(r.items[3].d, "2026-06-04");
  const p = I.plan(r, empty(), { now: NOW });
  assert.equal(p.check.ok, true);
  const pubE = p.exp.find((x) => x.t === "Pub");
  assert.equal(pubE.a, 5850);
  assert.deepEqual(pubE.fx.w, { [p.members[0].id]: 1667, [p.members[1].id]: 1667, [p.members[2].id]: 1666 });
});

test("bad, empty and over-cap files", () => {
  assert.deepEqual(I.parseText("", "x.csv"), { error: "empty" });
  assert.equal(I.parseText("a,b,c\n1,2,3\n", "x.csv").error, "bad");
  assert.equal(I.parseText("Date,Description,Category,Cost,Currency,A,B\n", "x.csv").error, "empty");
  // more than 30 people
  const names = Array.from({ length: 31 }, (_, i) => "P" + i);
  const row = ["2026-01-01", "x", "General", "31.00", "EUR"].concat(names.map((_, i) => (i ? "-1.00" : "30.00")));
  const csv = ["Date,Description,Category,Cost,Currency," + names.join(","), row.join(",")].join("\n");
  assert.equal(I.parseText(csv, "x.csv").error, "people");
  // currency Split does not have
  assert.equal(I.parseText("Date,Description,Category,Cost,Currency,A,B\n2026-01-01,x,General,10,INR,5,-5\n", "x.csv").error, "cur");
  // the group's people cap counts the people already there
  const d = empty();
  d.groups.push({ id: "big", m: 1, n: "Big", col: 0, cur: "EUR", arch: 0 });
  for (let i = 0; i < 29; i++) d.people.push({ id: "big.p" + i, m: 1, n: "Q" + i });
  assert.equal(I.plan(I.parseText(fx("splitwise.csv"), "x.csv"), d, { now: NOW, target: "big" }).error, "people");
});

test("categories map to Split's fixed ids", () => {
  const m = { "Dining out": "food", "Groceries": "groc", "Hotel": "stay", "Rent": "stay", "Taxi": "trans", "Gas/fuel": "trans",
    "Heat/gas": "bills", "Electricity": "bills", "Movies": "fun", "General": "other", "": "other", "Restaurants & bars": "food" };
  Object.keys(m).forEach((k) => assert.equal(I.catOf(k), m[k], k));
});
