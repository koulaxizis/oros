// Budget bank statement import (budget/bank.js, pure) and the new
// synced collections of budget.js (rules "rule", bank profiles "prof",
// the bank marker on entries). Run: node --test tests/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const K = require("../budget/bank.js");

const src = fs.readFileSync(path.join(__dirname, "..", "budget/budget.js"), "utf8");
function block(from, to) {
  const i = src.indexOf(from), j = src.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error("missing block " + from);
  return src.slice(i, j);
}
const B = new Function(
  block("  var STORAGE_KEY", "  // ---------- 1.") +
  block("  function cmpStr(", "  function newId(") +
  block("  // ---------- 2. Money", "  // ---------- 6. Storage") +
  "\nreturn { normTx, normRule, normProf, mergeBudget, emptyData };")();
const canon = (x) => JSON.stringify(x);
const enc = (s) => new TextEncoder().encode(s);

// ---------- text ----------
test("decode: UTF-8, BOM, Greek Windows-1253 and ISO-8859-7 sniffed, Western kept", () => {
  assert.deepEqual(K.decode(enc("Ημερομηνία;Ποσό\n"), "auto"), { text: "Ημερομηνία;Ποσό\n", enc: "utf-8" });
  assert.equal(K.decode(new Uint8Array([0xEF, 0xBB, 0xBF, 0x41]), "auto").text, "A");
  // "ΣΚΛΑΒΕΝΙΤΗΣ;12,50" in windows-1253
  const greek = new Uint8Array([0xD3, 0xCA, 0xCB, 0xC1, 0xC2, 0xC5, 0xCD, 0xC9, 0xD4, 0xC7, 0xD3, 0x3B, 0x31, 0x32, 0x2C, 0x35, 0x30]);
  const g = K.decode(greek, "auto");
  assert.equal(g.enc, "windows-1253");
  assert.equal(g.text, "ΣΚΛΑΒΕΝΙΤΗΣ;12,50");
  // "Café;3,50" in windows-1252: one accented letter among ASCII ones
  const fr = new Uint8Array([0x43, 0x61, 0x66, 0xE9, 0x3B, 0x33, 0x2C, 0x35, 0x30]);
  assert.equal(K.decode(fr, "auto").text, "Café;3,50");
  assert.equal(K.decode(greek, "iso-8859-7").text.slice(0, 3), "ΣΚΛ");
  // an XML charset declaration is honoured
  const xml = new Uint8Array([...enc('<?xml version="1.0" encoding="windows-1253"?><a>'), 0xC1, 0xE8, ...enc("</a>")]);
  assert.equal(K.decode(xml, "auto").enc, "windows-1253");
});

test("fold: case, accents and final sigma", () => {
  assert.equal(K.fold("  Σκλαβενίτης  ΑΕ "), "σκλαβενιτησ αε");
  assert.equal(K.fold("CAFÉ"), "cafe");
});

// ---------- numbers + dates ----------
test("amounts: Greek and English formats, signs, currency marks", () => {
  const c = { "1.234,56": 123456, "-1.234,56": -123456, "1.234,56-": -123456, "(12,50)": -1250, "12,5": 1250,
    "€ 1.000": 100000, "−3,20 €": -320, "0,00": 0, "1 234,56": 123456, "12,345": 1235 };
  Object.keys(c).forEach((s) => assert.equal(K.parseMoney(s, ","), c[s], s));
  const d = { "1,234.56": 123456, "-12.5": -1250, "12.50 DR": -1250, "12.50 CR": 1250, "+7": 700, "$1,000": 100000 };
  Object.keys(d).forEach((s) => assert.equal(K.parseMoney(s, "."), d[s], s));
  ["", "abc", "12,50,3x", "1-2"].forEach((s) => assert.equal(K.parseMoney(s, ","), null, s));
  assert.equal(K.detectDec(["1.234,56", "12,00", "3"], "."), ",");
  assert.equal(K.detectDec(["1,234.56", "12.00"], ","), ".");
  assert.equal(K.detectDec(["12", "300"], ","), ",");
});

test("dates: every common shape, and the order guessed from the values", () => {
  assert.equal(K.parseDate("14/10/2026", "dmy"), "2026-10-14");
  assert.equal(K.parseDate("10/14/2026", "mdy"), "2026-10-14");
  assert.equal(K.parseDate("14.10.26", "dmy"), "2026-10-14");
  assert.equal(K.parseDate("2026-10-14T10:22:00", "dmy"), "2026-10-14");
  assert.equal(K.parseDate("20261014120000[+2:EET]", "dmy"), "2026-10-14");
  assert.equal(K.parseDate("14/10/2026 10:22", "dmy"), "2026-10-14");
  assert.equal(K.parseDate("14 Oct 2026", "dmy"), "2026-10-14");
  assert.equal(K.parseDate("14 Οκτωβρίου 2026", "dmy"), "2026-10-14");
  assert.equal(K.parseDate("Oct 14, 2026", "dmy"), "2026-10-14");
  assert.equal(K.parseDate("10/14'26", "mdy"), "2026-10-14");   // QIF
  assert.equal(K.parseDate("31/02/2026", "dmy"), null);
  assert.equal(K.parseDate("hello", "dmy"), null);
  assert.equal(K.detectDateOrder(["01/02/2026", "14/02/2026"], "mdy"), "dmy");
  assert.equal(K.detectDateOrder(["02/01/2026", "02/14/2026"], "dmy"), "mdy");
  assert.equal(K.detectDateOrder(["01/02/2026"], "mdy"), "mdy");
  assert.equal(K.detectDateOrder(["2026-01-02"], "dmy"), "ymd");
});

// ---------- CSV ----------
const GREEK_CSV = "Λογαριασμός;GR1601101250000000012300695\n\n" +
  "Ημερομηνία;Περιγραφή;Ποσό;Χ/Π;Υπόλοιπο\n" +
  "14/10/2026;ΑΓΟΡΑ ΚΑΡΤΑΣ ΣΚΛΑΒΕΝΙΤΗΣ 123;1.234,56;Χ;100,00\n" +
  "13/10/2026;ΜΙΣΘΟΔΟΣΙΑ ΟΚΤ;2.000,00;Π;1.334,56\n" +
  "25/09/2026;\"LIDL; HELLAS\";23,40;Χ;5,00\n";

test("CSV: Greek bank with a preamble, ';', 1.234,56 and a Χ/Π marker", () => {
  const sep = K.guessSep(GREEK_CSV);
  assert.equal(sep, ";");
  const rows = K.parseCsv(GREEK_CSV, sep);
  const hd = K.findHeader(rows);
  assert.deepEqual(hd, { header: 1, start: 2, width: 5 });
  const m = K.guessMap(rows, hd, "el");
  assert.deepEqual([m.cd, m.cp, m.ca, m.cs, m.cdb, m.ccr, m.df, m.dec], [0, 1, 2, 3, -1, -1, "dmy", ","]);
  const it = K.csvItems(rows, hd.start, m);
  assert.deepEqual(it.map((x) => [x.d, x.amt, x.text]), [
    ["2026-10-14", -123456, "ΑΓΟΡΑ ΚΑΡΤΑΣ ΣΚΛΑΒΕΝΙΤΗΣ 123"],
    ["2026-10-13", 200000, "ΜΙΣΘΟΔΟΣΙΑ ΟΚΤ"],
    ["2026-09-25", -2340, "LIDL; HELLAS"]]);
  assert.equal(K.headerSig(rows[hd.header]), "ημερομηνια|περιγραφη|ποσο|χ/π|υπολοιπο");
});

test("CSV: debit/credit columns, US dates, quoted commas, reverse signs", () => {
  const csv = "Date,Description,Memo,Debit,Credit,Balance\r\n10/14/2026,\"Coffee, Inc\",card 1234,3.50,,100\r\n" +
              "10/13/2026,Salary,,,\"2,000.00\",103.5\r\n10/13/2026,Bad row,,x,,1\r\n";
  const rows = K.parseCsv(csv, K.guessSep(csv));
  const hd = K.findHeader(rows);
  const m = K.guessMap(rows, hd, "en");
  assert.deepEqual([m.cd, m.cp, m.cm, m.ca, m.cdb, m.ccr, m.df, m.dec], [0, 1, 2, -1, 3, 4, "mdy", "."]);
  const it = K.csvItems(rows, hd.start, m);
  assert.deepEqual(it.map((x) => [x.d, x.amt, x.text, x.err]), [
    ["2026-10-14", -350, "Coffee, Inc · card 1234", undefined],
    ["2026-10-13", 200000, "Salary", undefined],
    ["2026-10-13", null, "Bad row", "amount"]]);
  const inv = K.csvItems(rows, hd.start, Object.assign({}, m, { inv: true }));
  assert.equal(inv[0].amt, 350);
});

test("CSV: no header row, tab separated, ISO dates", () => {
  const csv = "2026-10-01\tRent\t-500.00\n2026-10-02\tShop\t-12.30\n";
  const rows = K.parseCsv(csv, K.guessSep(csv));
  const hd = K.findHeader(rows);
  assert.equal(hd.header, -1);
  const m = K.guessMap(rows, hd, "en");
  assert.deepEqual(K.csvItems(rows, hd.start, m).map((x) => x.amt), [-50000, -1230]);
  assert.equal(m.df, "ymd");
});

// ---------- OFX / QIF / CAMT ----------
const OFX = `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR
<BANKACCTFROM><BANKID>011<ACCTID>GR16 0110 1250<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261014120000[+2:EET]<TRNAMT>-23.40<FITID>A-1<NAME>LIDL HELLAS<MEMO>Card purchase</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261013<TRNAMT>2000,00<FITID>A-2<NAME>SALARY &amp; BONUS</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

test("OFX (SGML): amounts, dates, FITID, names, currency and account", () => {
  assert.equal(K.detectFormat(OFX, "x.ofx"), "ofx");
  const r = K.parseOfx(OFX);
  assert.equal(r.cur, "EUR");
  assert.equal(r.acct, "GR16 0110 1250");
  assert.deepEqual(r.items.map((x) => [x.d, x.amt, x.fit, x.text]), [
    ["2026-10-14", -2340, "A-1", "LIDL HELLAS · Card purchase"],
    ["2026-10-13", 200000, "A-2", "SALARY & BONUS"]]);
});

test("OFX 2 (XML) reads the same", () => {
  const x = '<?xml version="1.0"?><OFX><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260102</DTPOSTED><TRNAMT>-5.00</TRNAMT>' +
            "<FITID>9</FITID><NAME>Bakery</NAME></STMTTRN></OFX>";
  assert.deepEqual(K.parseOfx(x).items.map((i) => [i.d, i.amt, i.fit, i.text]), [["2026-01-02", -500, "9", "Bakery"]]);
});

test("QIF: records, US or European dates", () => {
  const q = "!Type:Bank\nD10/14'26\nT-23.40\nPLIDL\nMweekly shop\n^\nD10/13/2026\nT2,000.00\nPSalary\n^\n";
  assert.equal(K.detectFormat(q, "a.qif"), "qif");
  assert.equal(K.detectDateOrder(K.qifDates(q), "mdy"), "mdy");
  assert.deepEqual(K.parseQif(q, "mdy").items.map((x) => [x.d, x.amt, x.text]), [
    ["2026-10-14", -2340, "LIDL · weekly shop"], ["2026-10-13", 200000, "Salary"]]);
  const eu = "!Type:Bank\nD14.10.2026\nT-1.234,50\nPΔΕΗ\n^\n";
  assert.deepEqual(K.parseQif(eu, "dmy").items.map((x) => [x.d, x.amt]), [["2026-10-14", -123450]]);
});

const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
<Acct><Id><IBAN>GR1601101250000000012300695</IBAN></Id><Ccy>EUR</Ccy></Acct>
<Ntry><Amt Ccy="EUR">23.40</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-14</Dt></BookgDt>
 <AcctSvcrRef>REF-1</AcctSvcrRef><NtryDtls><TxDtls><RltdPties><Cdtr><Nm>ΣΚΛΑΒΕΝΙΤΗΣ ΑΕ</Nm></Cdtr></RltdPties>
 <RmtInf><Ustrd>Αγορά 123</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">2000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><DtTm>2026-10-13T09:00:00</DtTm></BookgDt>
 <NtryDtls><TxDtls><Refs><EndToEndId>E2E-7</EndToEndId></Refs><RltdPties><Dbtr><Nm>ACME &amp; Co</Nm></Dbtr></RltdPties></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="USD">9.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>PDNG</Sts><BookgDt><Dt>2026-10-15</Dt></BookgDt><AddtlNtryInf>Pending</AddtlNtryInf></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

test("CAMT.053: entries, debit/credit, references, parties, pending", () => {
  assert.equal(K.detectFormat(CAMT, "s.xml"), "camt");
  const r = K.parseCamt(CAMT);
  assert.equal(r.acct, "GR1601101250000000012300695");
  assert.equal(r.cur, "EUR");
  assert.deepEqual(r.items.map((x) => [x.d, x.amt, x.fit, x.text, x.err, x.cur]), [
    ["2026-10-14", -2340, "REF-1", "ΣΚΛΑΒΕΝΙΤΗΣ ΑΕ · Αγορά 123", undefined, "EUR"],
    ["2026-10-13", 200000, "E2E-7", "ACME & Co", undefined, "EUR"],
    ["2026-10-15", -900, "", "Pending", "pending", "USD"]]);
  // namespace prefixes are fine too
  const pre = CAMT.replace(/<(\/?)(\w)/g, "<$1ns:$2").replace("<ns:?xml", "<?xml");
  assert.equal(K.parseCamt(pre).items.length, 3);
});

// ---------- rules ----------
const RULES = [
  { id: "r1", m: 1, k: "o", c: "o-groc", q: "lidl", lo: 0, hi: 0, py: "Lidl", nt: "" },
  { id: "r2", m: 2, k: "o", c: "o-eat", q: "lidl hellas cafe", lo: 0, hi: 0, py: "", nt: "coffee" },
  { id: "r3", m: 3, k: "o", c: "o-bills", q: "", lo: 5000, hi: 9000, py: "", nt: "" },
  { id: "r4", m: 4, k: "i", c: "i-salary", q: "μισθοδοσια", lo: 0, hi: 0, py: "", nt: "" }
];
test("rules: longest text wins, amount ranges, kind, accents", () => {
  assert.equal(K.matchRule(RULES, "o", 2340, "POS LIDL HELLAS 22").id, "r1");
  assert.equal(K.matchRule(RULES, "o", 2340, "LIDL HELLAS CAFE 22").id, "r2");
  assert.equal(K.matchRule(RULES, "o", 6000, "ΔΕΗ").id, "r3");
  assert.equal(K.matchRule(RULES, "o", 9001, "ΔΕΗ"), null);
  assert.equal(K.matchRule(RULES, "i", 2340, "LIDL refund"), null);
  assert.equal(K.matchRule(RULES, "i", 200000, "ΜΙΣΘΟΔΟΣΊΑ ΟΚΤ").id, "r4");
  assert.equal(K.noteFor("POS LIDL HELLAS 22", RULES[0]), "Lidl");
  assert.equal(K.noteFor("LIDL HELLAS CAFE", RULES[1]), "LIDL HELLAS CAFE · coffee");
  assert.equal(K.suggestQ("POS 1234 LIDL HELLAS*22"), "LIDL HELLAS");
  assert.equal(K.suggestQ("ΑΓΟΡΑ ΚΑΡΤΑΣ ΣΚΛΑΒΕΝΙΤΗΣ ΑΕ 1"), "ΣΚΛΑΒΕΝΙΤΗΣ");
});

test("rules: re-run on uncategorised entries only, note only where the import wrote it", () => {
  const txs = [
    { id: "a", k: "o", a: 2340, c: "", n: "POS LIDL", ot: "POS LIDL", src: "bank" },
    { id: "b", k: "o", a: 2340, c: "", n: "my own note", ot: "LIDL 2", src: "bank" },
    { id: "c", k: "o", a: 2340, c: "o-fun", n: "LIDL", ot: "LIDL" },
    { id: "d", k: "o", a: 100, c: "", n: "lidl by hand" },
    { id: "e", k: "o", a: 100, c: "", n: "nothing" }
  ];
  assert.deepEqual(K.rerun(txs, RULES), [
    { id: "a", c: "o-groc", n: "Lidl" }, { id: "b", c: "o-groc", n: "my own note" }, { id: "d", c: "o-groc", n: "lidl by hand" }]);
});

// ---------- plan ----------
test("plan: new, same id, FITID twin, fuzzy duplicate, deleted earlier, skipped", () => {
  const items = [
    { line: 1, d: "2026-10-14", amt: -2340, text: "LIDL HELLAS 22", fit: "" },
    { line: 2, d: "2026-10-14", amt: -2340, text: "LIDL HELLAS 22", fit: "" },   // a second, identical purchase
    { line: 3, d: "2026-10-13", amt: 200000, text: "ΜΙΣΘΟΔΟΣΙΑ", fit: "" },
    { line: 4, d: "2026-10-12", amt: -500, text: "Bakery", fit: "F9" },
    { line: 5, d: "", amt: -1, text: "x", fit: "", err: "date" },
    { line: 6, d: "2026-10-10", amt: 0, text: "zero", fit: "" },
    { line: 7, d: "2026-10-11", amt: -700, text: "Kiosk", fit: "" }
  ];
  const ctx = { tx: [], tombs: {}, ac: "bank1", cur: "EUR", fileCur: "EUR", rules: RULES };
  const p1 = K.plan(items, ctx);
  assert.deepEqual(p1.map((r) => r.st), ["new", "new", "new", "new", "skip", "skip", "new"]);
  assert.notEqual(p1[0].id, p1[1].id);
  assert.ok(p1.every((r) => !r.id || /^b[a-z0-9]{14}$/.test(r.id)));
  assert.deepEqual([p1[0].c, p1[0].n, p1[0].k, p1[0].a], ["o-groc", "Lidl", "o", 2340]);
  assert.equal(p1[2].c, "i-salary");
  assert.deepEqual(K.counts(p1), { "new": 5, dup: 0, same: 0, gone: 0, skip: 2, on: 5 });
  // The same file again, on any device: same ids → "already imported".
  const ent = K.entries(p1, "bank1");
  assert.deepEqual(ent[0], { id: p1[0].id, d: "2026-10-14", a: 2340, k: "o", c: "o-groc", n: "Lidl", src: "bank", ac: "bank1", ot: "LIDL HELLAS 22" });
  assert.equal(ent[3].fit, "F9");
  const have = [ent[0], ent[2]].map((x) => Object.assign({ m: 1 }, x));
  have.push({ id: "manual1", m: 1, d: "2026-10-12", a: 500, k: "o", c: "o-eat", n: "", ac: "bank1", fit: "F9" });
  have.push({ id: "manual2", m: 1, d: "2026-10-11", a: 700, k: "o", c: "", n: "kiosk downtown", ac: "bank1" });
  const p2 = K.plan(items, Object.assign({}, ctx, { tx: have, tombs: { ["tx:" + p1[1].id]: 5 } }));
  assert.deepEqual(p2.map((r) => r.st), ["same", "gone", "same", "dup", "skip", "skip", "dup"]);
  assert.ok(p2.every((r) => !r.on));
  // Another account: nothing matches.
  const p3 = K.plan(items, Object.assign({}, ctx, { tx: have, ac: "" }));
  assert.deepEqual(p3.map((r) => r.st), ["new", "new", "new", "new", "skip", "skip", "new"]);
  // Another currency is skipped.
  assert.equal(K.plan(items.slice(0, 1), Object.assign({}, ctx, { fileCur: "USD" }))[0].why, "cur");
  assert.ok(K.similar("LIDL HELLAS 22", "lidl hellas"));
  assert.ok(!K.similar("LIDL HELLAS", "ΣΚΛΑΒΕΝΙΤΗΣ"));
});

// ---------- model in budget.js ----------
test("model: bank marker on entries, rules and profiles normalise, merge and stay canonical", () => {
  const t1 = B.normTx({ id: "b1", m: 1, d: "2026-10-14", a: 2340, k: "o", c: "", n: " Lidl ", src: "bank", ot: "POS  LIDL", fit: "A-1", zz: 1 });
  assert.deepEqual(Object.keys(t1), ["id", "m", "d", "a", "k", "c", "n", "fit", "ot", "src", "zz"]);
  assert.equal(t1.ot, "POS LIDL");
  const t2 = B.normTx({ id: "b2", m: 1, d: "2026-10-14", a: 1, k: "o", c: "", n: "", src: "BAD SRC", ot: "", fit: 5 });
  assert.deepEqual(Object.keys(t2), ["id", "m", "d", "a", "k", "c", "n"]);
  const r = B.normRule({ id: "r1", m: 3, k: "o", c: "o-groc", q: " lidl ", lo: 5, hi: 2, py: "", nt: "" });
  assert.deepEqual(r, { id: "r1", m: 3, c: "o-groc", hi: 0, k: "o", lo: 5, nt: "", py: "", q: "lidl" });
  assert.equal(B.normRule({ id: "r2", m: 1, k: "o", c: "o-groc", q: "", lo: 0, hi: 0 }), null);
  assert.equal(B.normRule({ id: "r2", m: 1, k: "x", c: "o-groc", q: "a" }), null);
  const p = B.normProf({ id: "p1", m: 2, n: "Eurobank", sep: ";", cd: 0, cp: 1, ca: 2, cs: 3, cdb: -1, ccr: -1, cm: -1,
                         df: "dmy", dec: ",", enc: "windows-1253", inv: false, ac: "bank1", sig: "a|b" });
  assert.deepEqual(Object.keys(p), ["id", "m", "ac", "ca", "ccr", "cd", "cdb", "cm", "cp", "cs", "dec", "df", "enc", "inv", "n", "sep", "sig"]);
  assert.equal(B.normProf({ id: "p2", m: 1, n: "" }), null);
  assert.equal(B.normProf({ id: "p3", m: 1, n: "X", sep: "x", enc: "koi8", cd: 999 }).sep, ",");
  // An older Budget keeps an unknown collection as { id, m, flat extras in name order }:
  // a rule and a profile written here look exactly like that, so both versions agree.
  const old = (x) => Object.assign({ id: x.id, m: x.m }, ...Object.keys(x).filter((k) => k !== "id" && k !== "m").sort().map((k) => ({ [k]: x[k] })));
  assert.equal(canon(old(r)), canon(r));
  assert.equal(canon(old(p)), canon(p));
  // Merge: LWW + tombstones, symmetric, idempotent.
  const a = Object.assign(B.emptyData(), { rule: [r], prof: [p], tx: [t1] });
  const b = Object.assign(B.emptyData(), { rule: [Object.assign({}, r, { m: 9, c: "o-eat" })], tombs: { "prof:p1": 5 } });
  const ab = B.mergeBudget(a, b);
  assert.equal(canon(ab), canon(B.mergeBudget(b, a)));
  assert.equal(canon(B.mergeBudget(ab, ab)), canon(ab));
  assert.equal(ab.rule[0].c, "o-eat");
  assert.deepEqual(ab.prof, []);
  assert.equal(ab.tx[0].src, "bank");
  // Old data (no rule / prof) still loads.
  const legacy = { ver: 1, tx: [{ id: "x", m: 1, d: "2026-01-01", a: 5, k: "o", c: "", n: "" }], cats: [], bud: [], rec: [], set: { m: 0, cur: "EUR" }, tombs: {} };
  const L = B.mergeBudget(legacy, legacy);
  assert.deepEqual([L.rule, L.prof, L.tx.length], [[], [], 1]);
});
