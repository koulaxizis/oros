// Budget "Import from another app" (budget/import.js, pure): detection
// and mapping of YNAB (new + YNAB 4), Wallet by BudgetBakers, Spendee,
// Money Lover, Monefy, Money Manager (Realbyte, .xlsx through the
// vendored SheetJS) and Firefly III; the plan over bank.js (ids,
// duplicates, deleted earlier, rules), accounts, categories made under
// Budget's rules, currencies; and that what it writes passes Budget's
// own normalizers and merge (with the Undo tombstones).
// Fixtures follow the documented export shapes.
// Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const I = require(path.join(ROOT, "budget/import.js"));
const XLSX = require(path.join(ROOT, "vendor/xlsx.full.min.js"));

const src = fs.readFileSync(path.join(ROOT, "budget/budget.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const BU = new Function(
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr(", "  function newId(") +
  block("  // ---------- 2. Money", "  // ---------- 6. Storage") +
  "\nreturn { normTx, normCat, normAcc, mergeBudget, emptyData };")();

const CATS = [
  { id: "o-groc", k: "o", name: "Groceries", alt: ["Groceries", "Σούπερ μάρκετ"] },
  { id: "o-eat", k: "o", name: "Eating out", alt: ["Eating out", "Φαγητό έξω"] },
  { id: "i-salary", k: "i", name: "Salary", alt: ["Salary", "Μισθός"] },
  { id: "u1", k: "o", name: "Fuel" }
];
const ctx = (over) => Object.assign({ tx: [], tombs: {}, rules: [], cur: "EUR", cats: CATS, accs: [], fx: null, maxCats: 60, maxAcc: 20 }, over || {});
const parseCsv = (text) => I.parse(I.csvTable(text));
const live = (res) => res.rows.filter((r) => r.st === "new");

// ---------- fixtures ----------
const YNAB =
  '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"\n' +
  '"Checking","","01/15/2024","Lidl","Everyday: Groceries","Everyday","Groceries","milk","€12.50","€0.00","Cleared"\n' +
  '"Checking","","01/16/2024","Employer","Inflow: Ready to Assign","Inflow","Ready to Assign","","€0.00","€2,000.00","Cleared"\n' +
  '"Checking","","01/17/2024","Transfer : Savings","","","","","€100.00","€0.00","Cleared"\n' +
  '"Checking","","01/01/2024","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","","€0.00","€500.00","Cleared"\n' +
  '"Visa","","01/18/2024","Cinema","Fun: Movies","Fun","Movies","","€9.00","€0.00","Uncleared"\n';
const YNAB4 =
  '"Account","Flag","Check Number","Date","Payee","Category","Master Category","Sub Category","Memo","Outflow","Inflow","Cleared","Running Balance"\n' +
  '"Cash","","","25/02/2015","Bakery","Food: Bread","Food","Bread","","$3.20","$0.00","C","$96.80"\n';
const WALLET =
  "account;category;currency;amount;ref_currency_amount;type;payment_type;payment_type_local;note;date;gps_latitude;gps_longitude;gps_accuracy_in_meters;warranty_in_month;transfer;payee;labels;envelope_id;custom_category\n" +
  "Cash;Groceries;EUR;-23.40;-23.40;Expenses;CASH;Cash;weekly shop;2024-03-02T10:15:00.000Z;;;;0;false;Lidl;home;1000;false\n" +
  "Card;Salary;EUR;1500.00;1500.00;Income;TRANSFER;Bank transfer;;2024-03-01T08:00:00.000Z;;;;0;false;ACME;\"work;monthly\";5000;false\n" +
  "Card;Restaurant;USD;-30.00;-27.50;Expenses;DEBIT_CARD;Debit card;dinner NYC;2024-03-05T20:00:00.000Z;;;;0;false;Joe's;;1000;false\n" +
  "Card;Transfer;EUR;-100.00;-100.00;Expenses;TRANSFER;Bank transfer;;2024-03-06T09:00:00.000Z;;;;0;true;;;20001;false\n";
const SPENDEE =
  "Date,Wallet,Type,Category name,Amount,Currency,Note,Labels,Author\n" +
  "2024-04-01T09:00:00+00:00,Main,Expense,Food & Drink,-8.5,EUR,Coffee and cake,breakfast,Me\n" +
  "2024-04-02T09:00:00+00:00,Main,Income,Salary,2100,EUR,,,Me\n" +
  "2024-04-03T09:00:00+00:00,Travel,Expense,Transport,-40,GBP,Train,,Me\n";
const MONEYLOVER =
  "Id;Date;Category;Amount;Currency;Note;Wallet\n" +
  "1;05/03/2024;Groceries;-45,60;EUR;Σκλαβενίτης;Cash\n" +
  "2;20/03/2024;Salary;1.250,00;EUR;;Bank\n" +
  "3;21/03/2024;Outgoing Transfer;-50,00;EUR;;Bank\n";
const MONEFY =
  "date,account,category,amount,currency,converted amount,currency,description\n" +
  "12/05/2024,Cash,Fuel,-60.00,EUR,-60.00,EUR,Shell\n" +
  "13/05/2024,Cash,Salary,1000.00,EUR,1000.00,EUR,\n" +
  "14/05/2024,Cash,Eating out,-25.00,CHF,-26.00,EUR,Zurich\n" +
  "15/05/2024,Cash,To 'Card',-30.00,EUR,-30.00,EUR,\n";
const FIREFLY =
  "user_id,group_id,journal_id,created_at,updated_at,group_title,type,amount,foreign_amount,currency_code,foreign_currency_code,description,date,source_name,source_iban,source_type,destination_name,destination_iban,destination_type,reconciled,category,budget,bill,tags,notes\n" +
  "1,10,101,2024-06-01,2024-06-01,,Withdrawal,-42.10,,EUR,,Weekly groceries,2024-06-01T00:00:00+02:00,Checking,,Asset account,AB Market,,Expense account,false,Groceries,Food,,\"food,weekly\",\n" +
  "1,11,102,2024-06-02,2024-06-02,,Deposit,2500.00,,EUR,,June salary,2024-06-02T00:00:00+02:00,ACME Inc,,Revenue account,Checking,,Asset account,false,Salary,,,,\n" +
  "1,12,103,2024-06-03,2024-06-03,,Transfer,-200.00,,EUR,,To savings,2024-06-03T00:00:00+02:00,Checking,,Asset account,Savings,,Asset account,false,,,,,\n" +
  "1,13,104,2024-01-01,2024-01-01,,Opening balance,1000.00,,EUR,,Opening,2024-01-01T00:00:00+02:00,Initial balance,,Initial balance account,Checking,,Asset account,false,,,,,\n";

// ---------- detection ----------
test("detect: every app from its header row; a bank CSV is none of them", () => {
  const head = (t) => I.csvTable(t).head;
  assert.equal(I.detect(head(YNAB)), "ynab");
  assert.equal(I.detect(head(YNAB4)), "ynab");
  assert.equal(I.detect(head(WALLET)), "wallet");
  assert.equal(I.detect(head(SPENDEE)), "spendee");
  assert.equal(I.detect(head(MONEYLOVER)), "moneylover");
  assert.equal(I.detect(head(MONEFY)), "monefy");
  assert.equal(I.detect(head(FIREFLY)), "firefly");
  assert.equal(I.detect(head("Date;Description;Amount;Balance\n01/02/2024;LIDL;-5,00;100,00\n")), "");
  assert.equal(I.detect(["Period", "Accounts", "Category", "Subcategory", "Note", "EUR", "Income/Expense", "Description", "Amount", "Currency"]), "moneymgr");
});

// ---------- mapping ----------
test("YNAB: outflow/inflow, mm/dd dates, transfers and starting balance skipped, Ready to Assign = no category", () => {
  const p = parseCsv(YNAB);
  assert.equal(p.src, "ynab");
  assert.deepEqual(p.items.map((i) => [i.d, i.amt, i.cat, i.acc, i.kind]), [
    ["2024-01-15", -1250, "Groceries", "Checking", ""],
    ["2024-01-16", 200000, "", "Checking", ""],
    ["2024-01-17", -10000, "", "Checking", "xfer"],
    ["2024-01-01", 50000, "", "Checking", "open"],
    ["2024-01-18", -900, "Movies", "Visa", ""]
  ]);
  assert.equal(p.items[0].text, "Lidl · milk");
  const q = parseCsv(YNAB4);
  assert.deepEqual([q.items[0].d, q.items[0].amt, q.items[0].cat], ["2015-02-25", -320, "Bread"]);
});

test("Wallet: signs from type, labels as tags, transfer flag, reference currency found", () => {
  const p = parseCsv(WALLET);
  assert.equal(p.src, "wallet");
  const [a, b, c, d] = p.items;
  assert.deepEqual([a.d, a.amt, a.cat, a.acc, a.text, a.tags], ["2024-03-02", -2340, "Groceries", "Cash", "Lidl · weekly shop", "#home"]);
  assert.equal(b.tags, "#work #monthly");
  assert.deepEqual([c.cur, c.amt, c.alt, c.altCur], ["USD", -3000, -2750, "EUR"]);
  assert.equal(d.kind, "xfer");
});

test("Spendee, Money Lover (; and 1.234,56, dd/mm), Monefy (second currency column)", () => {
  const s = parseCsv(SPENDEE);
  assert.deepEqual(s.items.map((i) => [i.d, i.amt, i.cat, i.acc, i.cur]), [
    ["2024-04-01", -850, "Food & Drink", "Main", "EUR"], ["2024-04-02", 210000, "Salary", "Main", "EUR"], ["2024-04-03", -4000, "Transport", "Travel", "GBP"]]);
  const m = parseCsv(MONEYLOVER);
  assert.deepEqual(m.items.map((i) => [i.d, i.amt, i.cat, i.acc, i.kind]), [
    ["2024-03-05", -4560, "Groceries", "Cash", ""], ["2024-03-20", 125000, "Salary", "Bank", ""], ["2024-03-21", -5000, "Outgoing Transfer", "Bank", "xfer"]]);
  const f = parseCsv(MONEFY);
  assert.deepEqual(f.items.map((i) => [i.d, i.amt, i.cur, i.alt, i.altCur, i.kind]), [
    ["2024-05-12", -6000, "EUR", -6000, "EUR", ""], ["2024-05-13", 100000, "EUR", 100000, "EUR", ""],
    ["2024-05-14", -2500, "CHF", -2600, "EUR", ""], ["2024-05-15", -3000, "EUR", -3000, "EUR", "xfer"]]);
});

test("Firefly III: withdrawal / deposit sides, tags, journal id kept, transfer and opening balance skipped", () => {
  const p = parseCsv(FIREFLY);
  const [w, d, t, o] = p.items;
  assert.deepEqual([w.amt, w.acc, w.text, w.cat, w.tags, w.fit], [-4210, "Checking", "AB Market · Weekly groceries", "Groceries", "#food #weekly", "ff:101"]);
  assert.deepEqual([d.amt, d.acc, d.text], [250000, "Checking", "ACME Inc · June salary"]);
  assert.equal(t.kind, "xfer");
  assert.equal(o.kind, "open");
});

test("Money Manager .xlsx: Date cells, Income/Exp. column, subcategory in the note, main-currency column", () => {
  const aoa = [
    ["Period", "Accounts", "Category", "Subcategory", "Note", "EUR", "Income/Expense", "Description", "Amount", "Currency", "Accounts"],
    [new Date(2024, 6, 3, 12, 30), "Cash", "Food", "Lunch", "Taverna", 18.5, "Exp.", "with Nikos", 18.5, "EUR", 18.5],
    [new Date(2024, 6, 4), "Bank", "Salary", "", "", 1900, "Income", "", 1900, "EUR", 1900],
    [new Date(2024, 6, 5), "Bank", "Food", "", "London", 21.4, "Exp.", "", 18, "GBP", 18],
    [new Date(2024, 6, 6), "Bank", "Cash", "", "", 50, "Transfer-Out", "", 50, "EUR", 50]
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, { cellDates: true }), "Sheet1");
  const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const rd = XLSX.read(new Uint8Array(bytes), { type: "array", cellDates: true });
  const table = I.sheetTable(XLSX.utils.sheet_to_json(rd.Sheets[rd.SheetNames[0]], { header: 1, raw: true, defval: "" }));
  const p = I.parse(table);
  assert.equal(p.src, "moneymgr");
  assert.deepEqual(p.items.map((i) => [i.d, i.amt, i.cat, i.acc, i.kind]), [
    ["2024-07-03", -1850, "Food", "Cash", ""], ["2024-07-04", 190000, "Salary", "Bank", ""],
    ["2024-07-05", -1800, "Food", "Bank", ""], ["2024-07-06", -5000, "Cash", "Bank", "xfer"]]);
  assert.equal(p.items[0].text, "Taverna · Lunch · with Nikos");
  assert.deepEqual([p.items[2].cur, p.items[2].alt, p.items[2].altCur], ["GBP", -2140, "EUR"]);
  // An Excel day number in a date column is a date too.
  assert.equal(I.cellDate(45476, "dmy"), "2024-07-03");
});

// ---------- plan ----------
test("plan: categories by name (either language), missing ones made once with stable ids, accounts as a note without Budget accounts", () => {
  const res = I.plan(parseCsv(YNAB), ctx());
  const rows = live(res);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].c, "o-groc");
  assert.equal(rows[1].c, "");                            // Ready to Assign: no category
  assert.equal(rows[2].c, I.catId("o", "Movies"));
  assert.ok(rows[2].newCat);
  assert.deepEqual(res.newCats, [{ id: I.catId("o", "Movies"), k: "o", name: "Movies", col: 0 }]);
  assert.deepEqual(res.newAccs, []);
  assert.equal(rows[0].ac, "");
  assert.equal(rows[0].n, "Lidl · milk · [Checking]");
  assert.deepEqual([res.info.xfer, res.info.open, res.info.from, res.info.to], [1, 1, "2024-01-15", "2024-01-18"]);
  // Greek ready-category name matches too; "no new categories" leaves it empty.
  const ml = I.plan(parseCsv(MONEYLOVER.replace("Groceries", "Σούπερ μάρκετ")), ctx(), { mkCats: false });
  assert.equal(live(ml)[0].c, "o-groc");
  // Category cap: Budget's 60.
  const full = I.plan(parseCsv(YNAB), ctx({ maxCats: CATS.length }));
  assert.equal(live(full)[2].c, "");
  assert.equal(full.info.full, 1);
});

test("plan: accounts matched by name, new ones (stable id, own currency) when Budget has accounts, cap kept", () => {
  const accs = [{ id: "a1", n: "checking" }];
  const res = I.plan(parseCsv(YNAB), ctx({ accs }));
  const rows = live(res);
  assert.equal(rows[0].ac, "a1");
  assert.equal(rows[2].ac, I.accId("Visa"));
  assert.deepEqual(res.newAccs, [{ id: I.accId("Visa"), n: "Visa", cur: "" }]);
  assert.equal(rows[2].n, "Cinema");
  const sp = I.plan(parseCsv(SPENDEE), ctx({ accs, fx: (c) => Math.round(c * 1.17) }));
  assert.deepEqual(sp.newAccs.map((a) => [a.n, a.cur]), [["Main", ""], ["Travel", "GBP"]]);
  const capped = I.plan(parseCsv(YNAB), ctx({ accs, maxAcc: 1 }));
  assert.equal(live(capped)[2].ac, "");
  assert.match(live(capped)[2].n, /\[Visa\]/);
  // An explicit choice wins: everything into "a1".
  const all = I.plan(parseCsv(YNAB), ctx({ accs }), { acc: { checking: "a1", visa: "a1" } });
  assert.deepEqual(live(all).map((r) => r.ac), ["a1", "a1", "a1"]);
});

test("plan: currencies — the app's own conversion first, else today's rate, else left out and counted", () => {
  const w = I.plan(parseCsv(WALLET), ctx());
  const usd = w.rows.find((r) => r.oc === "USD");
  assert.deepEqual([usd.a, usd.oa, usd.st], [2750, 3000, "new"]);
  const mf = I.plan(parseCsv(MONEFY), ctx());
  const chf = mf.rows.find((r) => r.oc === "CHF");
  assert.deepEqual([chf.a, chf.oa], [2600, 2500]);
  const noRate = I.plan(parseCsv(SPENDEE), ctx());
  const gbp = noRate.rows[2];
  assert.deepEqual([gbp.st, gbp.why, gbp.cur], ["skip", "rate", "GBP"]);
  assert.deepEqual(noRate.info.rate, { GBP: 1 });
  const withRate = I.plan(parseCsv(SPENDEE), ctx({ fx: (c, f, t) => (f === "GBP" && t === "EUR" ? Math.round(c * 1.17) : null) }));
  assert.deepEqual([withRate.rows[2].a, withRate.rows[2].oc, withRate.rows[2].oa], [4680, "GBP", 4000]);
});

test("plan: rules fill what the app left without a category; duplicates of hand-typed entries unticked", () => {
  const rules = [{ id: "r1", m: 1, k: "i", c: "i-salary", q: "employer", lo: 0, hi: 0, py: "", nt: "" }];
  const tx = [{ id: "mine", m: 1, d: "2024-01-15", a: 1250, k: "o", c: "o-groc", n: "Lidl" }];
  const res = I.plan(parseCsv(YNAB), ctx({ rules, tx }));
  assert.equal(res.rows[0].st, "dup");
  assert.equal(res.rows[0].on, false);
  assert.equal(res.rows[1].c, "i-salary");
  assert.equal(res.rows[1].rule, "r1");
});

test("re-import: same ids → already imported; deleted ones stay out; entries() writes only what is used", () => {
  const p = parseCsv(FIREFLY);
  const res = I.plan(p, ctx());
  const pkg = I.entries(res);
  assert.equal(pkg.tx.length, 2);
  assert.ok(pkg.tx.every((x) => x.src === "imp" && /^b[0-9a-z]{14}$/.test(x.id) && x.fit));
  assert.deepEqual(pkg.tx.map((x) => x.c), ["o-groc", "i-salary"]);
  assert.deepEqual(pkg.cats, []);
  // Same file again (ids from the file, not from this run).
  const again = I.plan(parseCsv(FIREFLY), ctx({ tx: pkg.tx.map((x) => Object.assign({ m: 5 }, x)) }));
  assert.deepEqual(again.rows.map((r) => r.st), ["same", "same", "skip", "skip"]);
  const tombs = {}; tombs["tx:" + pkg.tx[0].id] = 9;
  const gone = I.plan(parseCsv(FIREFLY), ctx({ tombs }));
  assert.deepEqual([gone.rows[0].st, gone.rows[0].on, gone.rows[1].st], ["gone", false, "new"]);
  // Two identical rows stay two entries.
  const twice = YNAB.split("\n").slice(0, 2).join("\n") + "\n" + YNAB.split("\n")[1] + "\n";
  const tw = I.entries(I.plan(parseCsv(twice), ctx()));
  assert.equal(tw.tx.length, 2);
  assert.notEqual(tw.tx[0].id, tw.tx[1].id);
});

test("written shape passes Budget's normalizers; Undo tombstones hide it on every device after merge", () => {
  const res = I.plan(parseCsv(WALLET), ctx({ accs: [{ id: "a1", n: "Other" }] }));
  const pkg = I.entries(res);
  const m = 1700000000000;
  const tx = pkg.tx.map((x) => BU.normTx(Object.assign({}, x, { m })));
  assert.ok(tx.every(Boolean));
  const usd = tx.find((x) => x.oc === "USD");
  assert.deepEqual([usd.a, usd.oa, usd.src], [2750, 3000, "imp"]);
  const cats = pkg.cats.map((c) => BU.normCat(Object.assign({ m }, c)));
  assert.ok(cats.length && cats.every(Boolean));
  const accs = pkg.accs.map((a) => BU.normAcc({ id: a.id, m, n: a.n, o: 0, col: 8 }));
  assert.ok(accs.length && accs.every(Boolean));
  const dev1 = Object.assign(BU.emptyData(), { tx, cats, acc: accs });
  const dev2 = BU.mergeBudget(BU.emptyData(), dev1);
  assert.equal(dev2.tx.length, tx.length);
  // Undo on device 1: removed + newer tombstones; device 2 still has them.
  const undone = BU.emptyData();
  tx.forEach((x) => { undone.tombs["tx:" + x.id] = m + 1; });
  cats.forEach((c) => { undone.tombs["cat:" + c.id] = m + 1; });
  accs.forEach((a) => { undone.tombs["acc:" + a.id] = m + 1; });
  const merged = BU.mergeBudget(dev2, undone);
  assert.deepEqual([merged.tx.length, merged.cats.length, merged.acc.length], [0, 0, 0]);
});

test("caps and safety: rows capped, text cleaned, nothing from a file is code", () => {
  const evil = '"Account","Date","Payee","Category","Memo","Outflow","Inflow"\n' +
    '"<img src=x onerror=alert(1)>","01/02/2024","\u0007=cmd|\' /C calc\'!A0","<b>x</b>","","1.00","0.00"\n';
  const p = parseCsv(evil);
  assert.equal(p.src, "ynab");
  assert.ok(!/[\u0000-\u001f]/.test(p.items[0].text));
  assert.ok(p.items[0].acc.length <= 30);
  const many = "Id;Date;Category;Amount;Currency;Note;Wallet\n" + Array.from({ length: 20050 }, (_, i) => `${i};01/01/2024;Food;-1;EUR;n${i};Cash`).join("\n");
  const pm = parseCsv(many);
  assert.equal(pm.items.length, I.MAX_ROWS);
  assert.ok(pm.more);
});
