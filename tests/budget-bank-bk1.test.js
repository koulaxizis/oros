// Budget bank import, wave BK-1: MT940, PayPal's activity CSV, and
// money already in Budget another way (Invoices payments, transfers
// between own accounts, the two sides of a PayPal payment).
// budget/bank.js is pure. Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("../budget/bank.js");

const MT940 = [
  "{1:F01BANKGRAAXXX0000000000}{4:",
  ":20:STMT001",
  ":25:GR1601101250000000012300695",
  ":28C:00001/001",
  ":60F:C261030EUR1500,00",
  ":61:2610311031D12,50NTRFNONREF//B1X00001",
  ":86:/NAME/ΣΚΛΑΒΕΝΙΤΗΣ ΑΕ/REMI/USTD//Αγορά κάρτας",
  ":61:261101C1250,00NTRF123//B1X00002",
  ":86:?00SEPA Gutschrift?20Μισθός Οκτωβρίου?32ACME ΑΕ",
  ":61:261101D4,00NCHG",
  ":86:Bank fee",
  ":62F:C261101EUR2733,50",
  "-}"
].join("\r\n");

test("MT940: detected, bookings with sign, date, reference and text", () => {
  assert.equal(K.detectFormat(MT940, "x.sta"), "mt940");
  assert.equal(K.detectFormat("Date;Amount\n01/02/2026;3,00", "x.csv"), "csv");
  const r = K.parseMt940(MT940);
  assert.equal(r.cur, "EUR");
  assert.equal(r.acct, "GR1601101250000000012300695");
  assert.equal(r.items.length, 3);
  assert.deepEqual([r.items[0].d, r.items[0].amt, r.items[0].fit], ["2026-10-31", -1250, "B1X00001"]);
  assert.equal(r.items[0].text, "ΣΚΛΑΒΕΝΙΤΗΣ ΑΕ · Αγορά κάρτας");
  assert.deepEqual([r.items[1].d, r.items[1].amt, r.items[1].fit], ["2026-11-01", 125000, "B1X00002"]);
  assert.equal(r.items[1].text, "ACME ΑΕ · Μισθός Οκτωβρίου");
  assert.deepEqual([r.items[2].amt, r.items[2].fit, r.items[2].text], [-400, "", "Bank fee"]);
  // same file twice → same ids, the second time nothing new
  const p1 = K.plan(r.items, { ac: "a1" });
  const tx = K.entries(p1, "a1").map((x) => Object.assign({ m: 1 }, x));
  assert.equal(tx.length, 3);
  assert.ok(K.plan(r.items, { ac: "a1", tx }).every((x) => x.st === "same"));
});

test("MT940: reversal and a bad line", () => {
  const t = ":20:X\n:25:ACC\n:60F:C260101EUR0,00\n:61:260102RD5,00NTRFREF1\n:86:Reversal\n:61:26XX02D5,00NTRF\n:86:broken\n";
  const r = K.parseMt940(t);
  assert.equal(r.items[0].amt, 500, "RD = a debit taken back: money in");
  assert.equal(r.items[1].err, "date");
});

const PP_HEAD = '"Date","Time","TimeZone","Name","Type","Status","Currency","Gross","Fee","Net","From Email Address","To Email Address","Transaction ID","Item Title","Reference Txn ID","Balance","Balance Impact"';
function ppRows(lines) {
  const text = [PP_HEAD].concat(lines).join("\n");
  const rows = K.parseCsv(text, K.guessSep(text));
  const hd = K.findHeader(rows);
  return { rows, hd, map: K.paypalMap(rows[hd.header]) };
}

test("PayPal: recognised by its columns; a plain bank CSV is not", () => {
  assert.ok(ppRows([]).map);
  assert.equal(K.paypalMap(["Date", "Description", "Amount", "Balance", "Currency", "Ref", "x"]), null);
  // the same file with Greek column names
  assert.ok(K.paypalMap(["Ημερομηνία", "Ώρα", "Όνομα", "Τύπος", "Κατάσταση", "Νόμισμα", "Μικτό", "Χρέωση", "Καθαρό", "Κωδικός συναλλαγής"]));
});

test("PayPal: payments, funding, holds, pending, foreign currency through its conversion", () => {
  const f = ppRows([
    '"28/10/2026","10:00:00","CET","Bandcamp","Express Checkout Payment","Completed","EUR","-12.00","0.00","-12.00","me@x","b@x","1AA","Album","","0.00","Debit"',
    '"28/10/2026","10:00:00","CET","","General Card Deposit","Completed","EUR","12.00","0.00","12.00","","","1AB","","1AA","12.00","Credit"',
    '"29/10/2026","11:00:00","CET","Shop Ltd","General Payment","Completed","USD","-10.00","0.00","-10.00","me@x","s@x","2AA","","","0.00","Debit"',
    '"29/10/2026","11:00:00","CET","","General Currency Conversion","Completed","USD","10.00","0.00","10.00","","","2AB","","2AA","0.00","Credit"',
    '"29/10/2026","11:00:00","CET","","General Currency Conversion","Completed","EUR","-9.40","0.00","-9.40","","","2AC","","2AA","0.00","Debit"',
    '"30/10/2026","09:00:00","CET","Client","Mobile Payment","Completed","EUR","50.00","-1.70","48.30","c@x","me@x","3AA","","","48.30","Credit"',
    '"31/10/2026","09:00:00","CET","Hotel","General Authorization","Pending","EUR","-80.00","0.00","-80.00","","","4AA","","","48.30","Memo"',
    '"31/10/2026","09:30:00","CET","Store","General Payment","Pending","EUR","-5.00","0.00","-5.00","","","5AA","","","48.30","Debit"',
    '"31/10/2026","12:00:00","CET","","General Withdrawal","Completed","EUR","-48.30","0.00","-48.30","","","6AA","","","0.00","Debit"'
  ]);
  const it = K.paypalItems(f.rows, f.hd.start, f.map, "EUR");
  const by = Object.fromEntries(it.map((x) => [x.fit, x]));
  assert.equal(it.length, 7, "conversion rows fold into their payment");
  assert.deepEqual([by["1AA"].amt, by["1AA"].d, by["1AA"].text, by["1AA"].err], [-1200, "2026-10-28", "Bandcamp · Album", undefined]);
  assert.equal(by["1AB"].err, "xfer");
  assert.deepEqual([by["2AA"].amt, by["2AA"].cur, by["2AA"].err], [-940, "EUR", undefined]);
  assert.equal(by["3AA"].amt, 4830, "net of PayPal's fee");
  assert.equal(by["4AA"].err, "memo");
  assert.equal(by["5AA"].err, "pending");
  assert.equal(by["6AA"].err, "xfer");
  const pl = K.plan(it, { ac: "pp", cur: "EUR", pp: true });
  assert.deepEqual(pl.filter((r) => r.on).map((r) => r.fit).sort(), ["1AA", "2AA", "3AA"]);
  const ent = K.entries(pl, "pp", true);
  assert.ok(ent.every((x) => x.pp === 1 && x.src === "bank" && x.ac === "pp"));
  // a USD payment with no conversion row stays in USD → skipped as another currency
  const g = ppRows(['"01/11/2026","1","CET","X","General Payment","Completed","USD","-3.00","0","-3.00","","","7AA","","","0","Debit"']);
  const pg = K.plan(K.paypalItems(g.rows, g.hd.start, g.map, "EUR"), { ac: "pp", cur: "EUR", pp: true });
  assert.deepEqual([pg[0].st, pg[0].why, pg[0].cur], ["skip", "cur", "USD"]);
});

test("Cross: the bank's PAYPAL line and the PayPal row are the same money (either order)", () => {
  const bankRow = { line: 1, d: "2026-10-29", amt: -1200, text: "PAYPAL *BANDCAMP 35314369001", fit: "" };
  const ppRow = { line: 1, d: "2026-10-28", amt: -1200, text: "Bandcamp · Album", fit: "1AA" };
  // PayPal first, then the bank statement
  const ppTx = K.entries(K.plan([ppRow], { ac: "pp", pp: true }), "pp", true).map((x) => Object.assign({ m: 1 }, x));
  const b = K.plan([bankRow], { ac: "alpha", tx: ppTx });
  assert.deepEqual([b[0].st, b[0].dk, b[0].on], ["dup", "pp", false]);
  // bank first, then PayPal
  const bTx = K.entries(K.plan([bankRow], { ac: "alpha" }), "alpha").map((x) => Object.assign({ m: 1 }, x));
  const p = K.plan([ppRow], { ac: "pp", pp: true, tx: bTx });
  assert.deepEqual([p[0].st, p[0].dk], ["dup", "pp"]);
  // no Budget accounts used at all: still the same money
  const ppNo = K.entries(K.plan([ppRow], { ac: "", pp: true }), "", true).map((x) => Object.assign({ m: 1 }, x));
  assert.equal(K.plan([bankRow], { ac: "", tx: ppNo })[0].dk, "pp");
  const bNo = K.entries(K.plan([bankRow], { ac: "" }), "").map((x) => Object.assign({ m: 1 }, x));
  assert.equal(K.plan([ppRow], { ac: "", pp: true, tx: bNo })[0].dk, "pp");
  // a PayPal file never matches its own rows, a bank file never its own
  assert.equal(K.plan([Object.assign({}, ppRow, { fit: "9ZZ", text: "PayPal fee" })], { ac: "", pp: true, tx: ppNo })[0].st, "new");
  // not PayPal, not within 4 days, or another amount → new
  assert.equal(K.plan([Object.assign({}, bankRow, { text: "SKLAVENITIS" })], { ac: "alpha", tx: ppTx })[0].st, "new");
  assert.equal(K.plan([Object.assign({}, bankRow, { d: "2026-11-05" })], { ac: "alpha", tx: ppTx })[0].st, "new");
  assert.equal(K.plan([Object.assign({}, bankRow, { amt: -1300 })], { ac: "alpha", tx: ppTx })[0].st, "new");
});

test("Cross: an Invoices payment already here; a transfer between own accounts", () => {
  const inv = { id: "l-invoices-abc", m: 1, d: "2026-10-20", a: 24800, k: "i", c: "", n: "Invoice 12", src: "invoices" };
  const credit = { line: 1, d: "2026-10-27", amt: 24800, text: "ΕΜΒΑΣΜΑ ACME ΑΕ", fit: "R1" };
  const r = K.plan([credit], { ac: "alpha", tx: [inv] });
  assert.deepEqual([r[0].st, r[0].dk, r[0].why], ["dup", "inv", "l-invoices-abc"]);
  assert.equal(K.plan([Object.assign({}, credit, { d: "2026-11-02" })], { ac: "alpha", tx: [inv] })[0].st, "new", "over 10 days");
  assert.equal(K.plan([Object.assign({}, credit, { amt: -24800 })], { ac: "alpha", tx: [inv] })[0].st, "new", "an expense never matches");
  // two Invoices payments of the same amount: two bank credits, each takes one
  const inv2 = Object.assign({}, inv, { id: "l-invoices-def", d: "2026-10-21" });
  const two = K.plan([credit, Object.assign({}, credit, { line: 2, fit: "R2" })], { ac: "alpha", tx: [inv, inv2] });
  assert.deepEqual(two.map((x) => x.why).sort(), ["l-invoices-abc", "l-invoices-def"]);
  // transfer alpha → viva of 200 €
  const xfer = [{ id: "x1", m: 1, d: "2026-10-10", a: 20000, f: "alpha", t: "viva", n: "" }];
  const out = { line: 1, d: "2026-10-11", amt: -20000, text: "ΜΕΤΑΦΟΡΑ ΠΡΟΣ VIVA", fit: "" };
  const inn = { line: 1, d: "2026-10-12", amt: 20000, text: "ΑΠΟ ALPHA", fit: "" };
  assert.equal(K.plan([out], { ac: "alpha", xfer })[0].dk, "xfer");
  assert.equal(K.plan([inn], { ac: "viva", xfer })[0].dk, "xfer");
  assert.equal(K.plan([inn], { ac: "alpha", xfer })[0].st, "new", "money into the account it left from is not that transfer");
  assert.equal(K.plan([out], { ac: "", xfer })[0].st, "new", "no Budget account chosen: no transfer match");
});
