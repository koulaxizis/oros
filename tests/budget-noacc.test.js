// NA-1/NA-2/NA-3 (Chris 2026-11-04, "Τι εννοεί Without an account;"):
// bank entries read while a bank had no account came in again once it
// had one. bank.js plan() now finds the copy without an account and
// moves it (adopts), noAccount() lists the month's entries without an
// account with their twins, and the Overview / Entries use both.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const B = require("../budget/bank.js");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

const items = [
  { line: 1, d: "2026-11-02", amt: -1250, text: "SKLAVENITIS 123", fit: "F1" },
  { line: 2, d: "2026-11-03", amt: 232653, text: "SALARY NOVEMBER" }
];

test("plan: an entry without an account is the twin of a reading for an account, and is adopted", () => {
  const first = B.entries(B.plan(items, { tx: [], ac: "" }), "");
  assert.equal(first.length, 2);
  assert.ok(first.every((x) => !x.ac));
  const tx = first.map((x) => Object.assign({ m: 1 }, x));
  const rows = B.plan(items, { tx, ac: "acc1" });
  assert.deepEqual(rows.map((r) => r.st), ["dup", "dup"]);
  assert.ok(rows.every((r) => r.adopt === 1 && r.dk === "noacc" && !r.on));
  assert.equal(B.entries(rows, "acc1").length, 0, "nothing comes in twice");
  assert.deepEqual(B.adopts(rows, "acc1"), { [first[0].id]: "acc1", [first[1].id]: "acc1" });
  assert.deepEqual(B.adopts(rows, ""), {});
});

test("plan: without an account nothing is adopted, and entries in another account are not twins", () => {
  const tx = B.entries(B.plan(items, { tx: [], ac: "acc2" }), "acc2").map((x) => Object.assign({ m: 1 }, x));
  const rows = B.plan(items, { tx, ac: "acc1" });
  assert.deepEqual(rows.map((r) => r.st), ["new", "new"]);
  assert.ok(rows.every((r) => !r.adopt));
  const none = B.plan(items, { tx: B.entries(B.plan(items, { tx: [], ac: "" }), "").map((x) => Object.assign({ m: 1 }, x)), ac: "" });
  assert.ok(none.every((r) => r.st === "same" && !r.adopt));
});

test("plan: a twin in the account itself still wins over one without an account", () => {
  const inAcc = { id: "a1", m: 1, d: "2026-11-02", a: 1250, k: "o", c: "", n: "", ot: "SKLAVENITIS 123", fit: "F1", ac: "acc1", src: "bank" };
  const noAcc = { id: "n1", m: 1, d: "2026-11-02", a: 1250, k: "o", c: "", n: "", ot: "SKLAVENITIS 123", fit: "F1", src: "bank" };
  const rows = B.plan([items[0]], { tx: [noAcc, inAcc], ac: "acc1" });
  assert.equal(rows[0].st, "dup");
  assert.equal(rows[0].why, "a1");
  assert.ok(!rows[0].adopt);
});

test("noAccount: twins by FITID or text, gone accounts count, one twin each, only the month", () => {
  const tx = [
    { id: "a1", d: "2026-11-02", a: 1250, k: "o", n: "", ot: "SKLAVENITIS 123", fit: "F1", ac: "acc1" },
    { id: "n1", d: "2026-11-02", a: 1250, k: "o", n: "", ot: "SKLAVENITIS 123", fit: "F1" },
    { id: "n1b", d: "2026-11-02", a: 1250, k: "o", n: "", ot: "SKLAVENITIS 123", fit: "F1" },
    { id: "a2", d: "2026-11-03", a: 232653, k: "i", n: "", ot: "SALARY NOVEMBER", ac: "acc1" },
    { id: "n2", d: "2026-11-03", a: 232653, k: "i", n: "", ot: "SALARY NOVEMBER", ac: "gone" },
    { id: "n3", d: "2026-11-03", a: 500, k: "o", n: "Coffee" },
    { id: "n4", d: "2026-11-03", a: 232653, k: "o", n: "SALARY NOVEMBER" },
    { id: "n5", d: "2026-10-30", a: 900, k: "o", n: "" }
  ];
  const r = B.noAccount(tx, "2026-11", ["acc1"]);
  assert.deepEqual(r.dups.map((p) => [p.x.id, p.twin.id]), [["n1", "a1"], ["n2", "a2"]]);
  assert.deepEqual(r.rest.map((x) => x.id), ["n1b", "n3", "n4"]);
  assert.deepEqual(B.noAccount(tx, "2026-12", ["acc1"]), { dups: [], rest: [] });
});

test("budget.js: addEntries moves adopted entries, fixNoAcc keeps the account copy, the Entries filter", () => {
  const js = read("budget/budget.js");
  assert.match(js, /function addEntries\(rows, doneText, moves\)/);
  assert.match(js, /function fixNoAcc\(dups, moves\)/);
  assert.match(js, /var NA_KEEP = \["c", "n", "rc", "crm"\];/);
  assert.match(js, /tombstone\("tx", x\.id\);/);
  assert.match(js, /on0\.value = "a:"/);
  assert.match(js, /filter === "a:" && x\.ac && findIn\(data\.acc, x\.ac\)/);
  for (const k of ["flt.noAcc", "na.gone", "na.moved"]) assert.ok(js.split('"' + k + '"').length - 1 >= 3, k + " EN + EL + use");
});

test("banklive, bankui and the Overview use it; every string in EN, EL and DE", () => {
  assert.match(read("budget/banklive.js"), /B\.adopts\(plan, row\.ac\)/);
  assert.match(read("budget/banklive.js"), /A\.addEntries\(add, t\("got", \{ n: add\.length \}\), adopt\)/);
  assert.match(read("budget/bankui.js"), /B\.adopts\(st\.plan, st\.ac\)/);
  const ov = read("budget/overviewui.js"), de = read("i18n/de/budget.js");
  assert.match(ov, /function noAccSheet\(mk\)/);
  const keys = ["ov.naTip", "ov.naDupsS", "ov.naWhat", "ov.naDups", "ov.naDupsHint", "ov.naIn", "ov.naDrop", "ov.naRest",
    "ov.naRestHint", "ov.naPick", "ov.naTo", "ov.naMove", "ov.naList", "ov.naNone", "ov.naMore"];
  for (const k of keys) {
    assert.equal(ov.split('"' + k + '"').length - 1, 3, k + " EN + EL + use");
    assert.ok(de.includes('"' + k + '":'), k + " DE");
  }
  for (const k of ["dup_noacc", "flt.noAcc", "na.gone", "na.moved"]) assert.ok(de.includes('"' + k + '":'), k + " DE");
});
